/**
 * products - defines the behavior of weather data grids, including grid construction, interpolation, and color scales.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
var products = function() {
    "use strict";

    var WEATHER_PATH = "/data/weather";
    var OSCAR_PATH = "/data/oscar";
    var catalogs = {
        // The OSCAR catalog is an array of file names, sorted and prefixed with yyyyMMdd. Last item is the
        // most recent. For example: [ 20140101-abc.json, 20140106-abc.json, 20140112-abc.json, ... ]
        oscar: µ.loadJson([OSCAR_PATH, "catalog.json"].join("/"))
    };

    function buildProduct(overrides) {
        return _.extend({
            description: "",
            paths: [],
            date: null,
            navigate: function(step) {
                return gfsStep(this.date, step);
            },
            load: function(cancel) {
                var me = this;
                return when.map(this.paths, µ.loadJson).then(function(files) {
                    return cancel.requested ? null : _.extend(me, buildGrid(me.builder.apply(me, files)));
                });
            }
        }, overrides);
    }

    /**
     * @param attr
     * @param {String} type
     * @param {String?} surface
     * @param {String?} level
     * @returns {String}
     */
    function gfs1p0degPath(attr, type, surface, level) {
        var dir = attr.date, stamp = dir === "current" ? "current" : attr.hour;
        var file = [stamp, type, surface, level, "gfs", "1.0"].filter(µ.isValue).join("-") + ".json";
        return [WEATHER_PATH, dir, file].join("/");
    }

    function gfsDate(attr) {
        if (attr.date === "current") {
            // Construct the date from the current time, rounding down to the nearest three-hour block.
            var now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
        }
        var parts = attr.date.split("/");
        return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substr(0, 2)));
    }

    /**
     * Returns a date for the chronologically next or previous GFS data layer. How far forward or backward in time
     * to jump is determined by the step. Steps of ±1 move in 3-hour jumps, and steps of ±10 move in 24-hour jumps.
     */
    function gfsStep(date, step) {
        var offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
        adjusted.setHours(adjusted.getHours() + offset);
        return adjusted;
    }

    function netcdfHeader(time, lat, lon, center) {
        return {
            lo1: lon.sequence.start,
            la1: lat.sequence.start,
            dx: lon.sequence.delta,
            dy: -lat.sequence.delta,
            nx: lon.sequence.size,
            ny: lat.sequence.size,
            refTime: time.data[0],
            forecastTime: 0,
            centerName: center
        };
    }

    function describeSurface(attr) {
        return attr.surface === "surface" ? "Surface" : µ.capitalize(attr.level);
    }

    function describeSurfaceJa(attr) {
        return attr.surface === "surface" ? "地上" : µ.capitalize(attr.level);
    }

    /**
     * Returns a function f(langCode) that, given table:
     *     {foo: {en: "A", ja: "あ"}, bar: {en: "I", ja: "い"}}
     * will return the following when called with "en":
     *     {foo: "A", bar: "I"}
     * or when called with "ja":
     *     {foo: "あ", bar: "い"}
     */
    function localize(table) {
        return function(langCode) {
            var result = {};
            _.each(table, function(value, key) {
                result[key] = value[langCode] || value.en || value;
            });
            return result;
        }
    }

    var FACTORIES = {

        "wind": {
            matches: _.matches({param: "wind"}),
            create: function(attr) {
                return buildProduct({
                    field: "vector",
                    type: "wind",
                    description: localize({
                        name: {en: "Wind", ja: "風速"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "wind", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var uData = file[0].data, vData = file[1].data;
                        return {
                            header: file[0].header,
                            interpolate: bilinearInterpolateVector,
                            data: function(i) {
                                return [uData[i], vData[i]];
                            }
                        }
                    },
                    units: [
                        {label: "km/h", conversion: function(x) { return x * 3.6; },      precision: 0},
                        {label: "m/s",  conversion: function(x) { return x; },            precision: 1},
                        {label: "kn",   conversion: function(x) { return x * 1.943844; }, precision: 0},
                        {label: "mph",  conversion: function(x) { return x * 2.236936; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 100],
                        gradient: function(v, a) {
                            return µ.extendedSinebowColor(Math.min(v, 100) / 100, a);
                        }
                    },
                    particles: {velocityScale: 1/60000, maxIntensity: 17}
                });
            }
        },

        "temp": {
            matches: _.matches({param: "wind", overlayType: "temp"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "temp",
                    description: localize({
                        name: {en: "Temp", ja: "気温"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "temp", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "°C", conversion: function(x) { return x - 273.15; },       precision: 1},
                        {label: "°F", conversion: function(x) { return x * 9/5 - 459.67; }, precision: 1},
                        {label: "K",  conversion: function(x) { return x; },                precision: 1}
                    ],
                    scale: {
                        bounds: [193, 328],
                        gradient: µ.segmentedColorScale([
                            [193,     [37, 4, 42]],
                            [206,     [41, 10, 130]],
                            [219,     [81, 40, 40]],
                            [233.15,  [192, 37, 149]],  // -40 C/F
                            [255.372, [70, 215, 215]],  // 0 F
                            [273.15,  [21, 84, 187]],   // 0 C
                            [275.15,  [24, 132, 14]],   // just above 0 C
                            [291,     [247, 251, 59]],
                            [298,     [235, 167, 21]],
                            [311,     [230, 71, 39]],
                            [328,     [88, 27, 67]]
                        ])
                    }
                });
            }
        },

        "relative_humidity": {
            matches: _.matches({param: "wind", overlayType: "relative_humidity"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "relative_humidity",
                    description: localize({
                        name: {en: "Relative Humidity", ja: "相対湿度"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "relative_humidity", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        };
                    },
                    units: [
                        {label: "%", conversion: function(x) { return x; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 100],
                        gradient: 
                            µ.segmentedColorScale([
                                [0, [230, 165, 30]],
                                [17, [120, 100, 95]],
                                [34, [40, 44, 92]],
                                [52, [21, 13, 193]],
                                [68, [75, 63, 235]],
                                [85, [25, 255, 255]],
                                [100, [150, 255, 255]]
                            ])
                    }
                });
            }
        },

        "air_density": {
            matches: _.matches({param: "wind", overlayType: "air_density"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "air_density",
                    description: localize({
                        name: {en: "Air Density", ja: "空気密度"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "air_density", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var vars = file.variables;
                        var air_density = vars.air_density, data = air_density.data;
                        return {
                            header: netcdfHeader(vars.time, vars.lat, vars.lon, file.Originating_or_generating_Center),
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        };
                    },
                    units: [
                        {label: "kg/m³", conversion: function(x) { return x; }, precision: 2}
                    ],
                    scale: {
                        bounds: [0, 1.5],
                        gradient: function(v, a) {
                            return µ.sinebowColor(Math.min(v, 1.5) / 1.5, a);
                        }
                    }
                });
            }
        },

        "wind_power_density": {
            matches: _.matches({param: "wind", overlayType: "wind_power_density"}),
            create: function(attr) {
                var windProduct = FACTORIES.wind.create(attr);
                var airdensProduct = FACTORIES.air_density.create(attr);
                return buildProduct({
                    field: "scalar",
                    type: "wind_power_density",
                    description: localize({
                        name: {en: "Wind Power Density", ja: "風力エネルギー密度"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [windProduct.paths[0], airdensProduct.paths[0]],
                    date: gfsDate(attr),
                    builder: function(windFile, airdensFile) {
                        var windBuilder = windProduct.builder(windFile);
                        var airdensBuilder = airdensProduct.builder(airdensFile);
                        var windData = windBuilder.data, windInterpolate = windBuilder.interpolate;
                        var airdensData = airdensBuilder.data, airdensInterpolate = airdensBuilder.interpolate;
                        return {
                            header: _.clone(airdensBuilder.header),
                            interpolate: function(x, y, g00, g10, g01, g11) {
                                var m = windInterpolate(x, y, g00[0], g10[0], g01[0], g11[0])[2];
                                var ρ = airdensInterpolate(x, y, g00[1], g10[1], g01[1], g11[1]);
                                return 0.5 * ρ * m * m * m;
                            },
                            data: function(i) {
                                return [windData(i), airdensData(i)];
                            }
                        };
                    },
                    units: [
                        {label: "kW/m²", conversion: function(x) { return x / 1000; }, precision: 1},
                        {label: "W/m²", conversion: function(x) { return x; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 80000],
                        gradient: µ.segmentedColorScale([
                            [0, [15, 4, 96]],
                            [250, [30, 8, 180]],
                            [1000, [121, 102, 2]],
                            [2000, [118, 161, 66]],
                            [4000, [50, 102, 219]],
                            [8000, [19, 131, 193]],
                            [16000, [59, 204, 227]],
                            [64000, [241, 1, 45]],
                            [80000, [243, 0, 241]]
                        ])
                    }
                });
            }
        },

        "total_cloud_water": {
            matches: _.matches({param: "wind", overlayType: "total_cloud_water"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "total_cloud_water",
                    description: localize({
                        name: {en: "Total Cloud Water", ja: "雲水量"},
                        qualifier: ""
                    }),
                    paths: [gfs1p0degPath(attr, "total_cloud_water")],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "kg/m²", conversion: function(x) { return x; }, precision: 3}
                    ],
                    scale: {
                        bounds: [0, 1],
                        gradient: µ.segmentedColorScale([
                            [0.0, [5, 5, 89]],
                            [0.2, [170, 170, 230]],
                            [1.0, [255, 255, 255]]
                        ])
                    }
                });
            }
        },

        "total_precipitable_water": {
            matches: _.matches({param: "wind", overlayType: "total_precipitable_water"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "total_precipitable_water",
                    description: localize({
                        name: {en: "Total Precipitable Water", ja: "可降水量"},
                        qualifier: ""
                    }),
                    paths: [gfs1p0degPath(attr, "total_precipitable_water")],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "kg/m²", conversion: function(x) { return x; }, precision: 3}
                    ],
                    scale: {
                        bounds: [0, 70],
                        gradient:
                            µ.segmentedColorScale([
                                [0, [230, 165, 30]],
                                [10, [120, 100, 95]],
                                [20, [40, 44, 92]],
                                [30, [21, 13, 193]],
                                [40, [75, 63, 235]],
                                [60, [25, 255, 255]],
                                [70, [150, 255, 255]]
                            ])
                    }
                });
            }
        },

        "mean_sea_level_pressure": {
            matches: _.matches({param: "wind", overlayType: "mean_sea_level_pressure"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "mean_sea_level_pressure",
                    description: localize({
                        name: {en: "Mean Sea Level Pressure", ja: "海面更正気圧"},
                        qualifier: ""
                    }),
                    paths: [gfs1p0degPath(attr, "mean_sea_level_pressure")],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "hPa", conversion: function(x) { return x / 100; }, precision: 0},
                        {label: "mmHg", conversion: function(x) { return x / 133.322387415; }, precision: 0},
                        {label: "inHg", conversion: function(x) { return x / 3386.389; }, precision: 1}
                    ],
                    scale: {
                        bounds: [95000, 105000],
                        gradient: µ.segmentedColorScale([
                            [95000.0, [255 * 0.267004, 255 * 0.004874, 255 * 0.329415]],
                            [95039.2, [255 * 0.268510, 255 * 0.009605, 255 * 0.335427]],
                            [95078.4, [255 * 0.269944, 255 * 0.014625, 255 * 0.341379]],
                            [95117.6, [255 * 0.271305, 255 * 0.019942, 255 * 0.347269]],
                            [95156.8, [255 * 0.272594, 255 * 0.025563, 255 * 0.353093]],
                            [95196.0, [255 * 0.273809, 255 * 0.031497, 255 * 0.358853]],
                            [95235.2, [255 * 0.274952, 255 * 0.037752, 255 * 0.364543]],
                            [95274.5, [255 * 0.276022, 255 * 0.044167, 255 * 0.370164]],
                            [95313.7, [255 * 0.277018, 255 * 0.050344, 255 * 0.375715]],
                            [95352.9, [255 * 0.277941, 255 * 0.056324, 255 * 0.381191]],
                            [95392.1, [255 * 0.278791, 255 * 0.062145, 255 * 0.386592]],
                            [95431.3, [255 * 0.279566, 255 * 0.067836, 255 * 0.391917]],
                            [95470.5, [255 * 0.280267, 255 * 0.073417, 255 * 0.397163]],
                            [95509.8, [255 * 0.280894, 255 * 0.078907, 255 * 0.402329]],
                            [95549.0, [255 * 0.281446, 255 * 0.084320, 255 * 0.407414]],
                            [95588.2, [255 * 0.281924, 255 * 0.089666, 255 * 0.412415]],
                            [95627.4, [255 * 0.282327, 255 * 0.094955, 255 * 0.417331]],
                            [95666.6, [255 * 0.282656, 255 * 0.100196, 255 * 0.422160]],
                            [95705.8, [255 * 0.282910, 255 * 0.105393, 255 * 0.426902]],
                            [95745.0, [255 * 0.283091, 255 * 0.110553, 255 * 0.431554]],
                            [95784.3, [255 * 0.283197, 255 * 0.115680, 255 * 0.436115]],
                            [95823.5, [255 * 0.283229, 255 * 0.120777, 255 * 0.440584]],
                            [95862.7, [255 * 0.283187, 255 * 0.125848, 255 * 0.444960]],
                            [95901.9, [255 * 0.283072, 255 * 0.130895, 255 * 0.449241]],
                            [95941.1, [255 * 0.282884, 255 * 0.135920, 255 * 0.453427]],
                            [95980.3, [255 * 0.282623, 255 * 0.140926, 255 * 0.457517]],
                            [96019.6, [255 * 0.282290, 255 * 0.145912, 255 * 0.461510]],
                            [96058.8, [255 * 0.281887, 255 * 0.150881, 255 * 0.465405]],
                            [96098.0, [255 * 0.281412, 255 * 0.155834, 255 * 0.469201]],
                            [96137.2, [255 * 0.280868, 255 * 0.160771, 255 * 0.472899]],
                            [96176.4, [255 * 0.280255, 255 * 0.165693, 255 * 0.476498]],
                            [96215.6, [255 * 0.279574, 255 * 0.170599, 255 * 0.479997]],
                            [96254.9, [255 * 0.278826, 255 * 0.175490, 255 * 0.483397]],
                            [96294.1, [255 * 0.278012, 255 * 0.180367, 255 * 0.486697]],
                            [96333.3, [255 * 0.277134, 255 * 0.185228, 255 * 0.489898]],
                            [96372.5, [255 * 0.276194, 255 * 0.190074, 255 * 0.493001]],
                            [96411.7, [255 * 0.275191, 255 * 0.194905, 255 * 0.496005]],
                            [96450.9, [255 * 0.274128, 255 * 0.199721, 255 * 0.498911]],
                            [96490.1, [255 * 0.273006, 255 * 0.204520, 255 * 0.501721]],
                            [96529.4, [255 * 0.271828, 255 * 0.209303, 255 * 0.504434]],
                            [96568.6, [255 * 0.270595, 255 * 0.214069, 255 * 0.507052]],
                            [96607.8, [255 * 0.269308, 255 * 0.218818, 255 * 0.509577]],
                            [96647.0, [255 * 0.267968, 255 * 0.223549, 255 * 0.512008]],
                            [96686.2, [255 * 0.266580, 255 * 0.228262, 255 * 0.514349]],
                            [96725.4, [255 * 0.265145, 255 * 0.232956, 255 * 0.516599]],
                            [96764.7, [255 * 0.263663, 255 * 0.237631, 255 * 0.518762]],
                            [96803.9, [255 * 0.262138, 255 * 0.242286, 255 * 0.520837]],
                            [96843.1, [255 * 0.260571, 255 * 0.246922, 255 * 0.522828]],
                            [96882.3, [255 * 0.258965, 255 * 0.251537, 255 * 0.524736]],
                            [96921.5, [255 * 0.257322, 255 * 0.256130, 255 * 0.526563]],
                            [96960.7, [255 * 0.255645, 255 * 0.260703, 255 * 0.528312]],
                            [97000.0, [255 * 0.253935, 255 * 0.265254, 255 * 0.529983]],
                            [97039.2, [255 * 0.252194, 255 * 0.269783, 255 * 0.531579]],
                            [97078.4, [255 * 0.250425, 255 * 0.274290, 255 * 0.533103]],
                            [97117.6, [255 * 0.248629, 255 * 0.278775, 255 * 0.534556]],
                            [97156.8, [255 * 0.246811, 255 * 0.283237, 255 * 0.535941]],
                            [97196.0, [255 * 0.244972, 255 * 0.287675, 255 * 0.537260]],
                            [97235.2, [255 * 0.243113, 255 * 0.292092, 255 * 0.538516]],
                            [97274.5, [255 * 0.241237, 255 * 0.296485, 255 * 0.539709]],
                            [97313.7, [255 * 0.239346, 255 * 0.300855, 255 * 0.540844]],
                            [97352.9, [255 * 0.237441, 255 * 0.305202, 255 * 0.541921]],
                            [97392.1, [255 * 0.235526, 255 * 0.309527, 255 * 0.542944]],
                            [97431.3, [255 * 0.233603, 255 * 0.313828, 255 * 0.543914]],
                            [97470.5, [255 * 0.231674, 255 * 0.318106, 255 * 0.544834]],
                            [97509.8, [255 * 0.229739, 255 * 0.322361, 255 * 0.545706]],
                            [97549.0, [255 * 0.227802, 255 * 0.326594, 255 * 0.546532]],
                            [97588.2, [255 * 0.225863, 255 * 0.330805, 255 * 0.547314]],
                            [97627.4, [255 * 0.223925, 255 * 0.334994, 255 * 0.548053]],
                            [97666.6, [255 * 0.221989, 255 * 0.339161, 255 * 0.548752]],
                            [97705.8, [255 * 0.220057, 255 * 0.343307, 255 * 0.549413]],
                            [97745.0, [255 * 0.218130, 255 * 0.347432, 255 * 0.550038]],
                            [97784.3, [255 * 0.216210, 255 * 0.351535, 255 * 0.550627]],
                            [97823.5, [255 * 0.214298, 255 * 0.355619, 255 * 0.551184]],
                            [97862.7, [255 * 0.212395, 255 * 0.359683, 255 * 0.551710]],
                            [97901.9, [255 * 0.210503, 255 * 0.363727, 255 * 0.552206]],
                            [97941.1, [255 * 0.208623, 255 * 0.367752, 255 * 0.552675]],
                            [97980.3, [255 * 0.206756, 255 * 0.371758, 255 * 0.553117]],
                            [98019.6, [255 * 0.204903, 255 * 0.375746, 255 * 0.553533]],
                            [98058.8, [255 * 0.203063, 255 * 0.379716, 255 * 0.553925]],
                            [98098.0, [255 * 0.201239, 255 * 0.383670, 255 * 0.554294]],
                            [98137.2, [255 * 0.199430, 255 * 0.387607, 255 * 0.554642]],
                            [98176.4, [255 * 0.197636, 255 * 0.391528, 255 * 0.554969]],
                            [98215.6, [255 * 0.195860, 255 * 0.395433, 255 * 0.555276]],
                            [98254.9, [255 * 0.194100, 255 * 0.399323, 255 * 0.555565]],
                            [98294.1, [255 * 0.192357, 255 * 0.403199, 255 * 0.555836]],
                            [98333.3, [255 * 0.190631, 255 * 0.407061, 255 * 0.556089]],
                            [98372.5, [255 * 0.188923, 255 * 0.410910, 255 * 0.556326]],
                            [98411.7, [255 * 0.187231, 255 * 0.414746, 255 * 0.556547]],
                            [98450.9, [255 * 0.185556, 255 * 0.418570, 255 * 0.556753]],
                            [98490.1, [255 * 0.183898, 255 * 0.422383, 255 * 0.556944]],
                            [98529.4, [255 * 0.182256, 255 * 0.426184, 255 * 0.557120]],
                            [98568.6, [255 * 0.180629, 255 * 0.429975, 255 * 0.557282]],
                            [98607.8, [255 * 0.179019, 255 * 0.433756, 255 * 0.557430]],
                            [98647.0, [255 * 0.177423, 255 * 0.437527, 255 * 0.557565]],
                            [98686.2, [255 * 0.175841, 255 * 0.441290, 255 * 0.557685]],
                            [98725.4, [255 * 0.174274, 255 * 0.445044, 255 * 0.557792]],
                            [98764.7, [255 * 0.172719, 255 * 0.448791, 255 * 0.557885]],
                            [98803.9, [255 * 0.171176, 255 * 0.452530, 255 * 0.557965]],
                            [98843.1, [255 * 0.169646, 255 * 0.456262, 255 * 0.558030]],
                            [98882.3, [255 * 0.168126, 255 * 0.459988, 255 * 0.558082]],
                            [98921.5, [255 * 0.166617, 255 * 0.463708, 255 * 0.558119]],
                            [98960.7, [255 * 0.165117, 255 * 0.467423, 255 * 0.558141]],
                            [99000.0, [255 * 0.163625, 255 * 0.471133, 255 * 0.558148]],
                            [99039.2, [255 * 0.162142, 255 * 0.474838, 255 * 0.558140]],
                            [99078.4, [255 * 0.160665, 255 * 0.478540, 255 * 0.558115]],
                            [99117.6, [255 * 0.159194, 255 * 0.482237, 255 * 0.558073]],
                            [99156.8, [255 * 0.157729, 255 * 0.485932, 255 * 0.558013]],
                            [99196.0, [255 * 0.156270, 255 * 0.489624, 255 * 0.557936]],
                            [99235.2, [255 * 0.154815, 255 * 0.493313, 255 * 0.557840]],
                            [99274.5, [255 * 0.153364, 255 * 0.497000, 255 * 0.557724]],
                            [99313.7, [255 * 0.151918, 255 * 0.500685, 255 * 0.557587]],
                            [99352.9, [255 * 0.150476, 255 * 0.504369, 255 * 0.557430]],
                            [99392.1, [255 * 0.149039, 255 * 0.508051, 255 * 0.557250]],
                            [99431.3, [255 * 0.147607, 255 * 0.511733, 255 * 0.557049]],
                            [99470.5, [255 * 0.146180, 255 * 0.515413, 255 * 0.556823]],
                            [99509.8, [255 * 0.144759, 255 * 0.519093, 255 * 0.556572]],
                            [99549.0, [255 * 0.143343, 255 * 0.522773, 255 * 0.556295]],
                            [99588.2, [255 * 0.141935, 255 * 0.526453, 255 * 0.555991]],
                            [99627.4, [255 * 0.140536, 255 * 0.530132, 255 * 0.555659]],
                            [99666.6, [255 * 0.139147, 255 * 0.533812, 255 * 0.555298]],
                            [99705.8, [255 * 0.137770, 255 * 0.537492, 255 * 0.554906]],
                            [99745.0, [255 * 0.136408, 255 * 0.541173, 255 * 0.554483]],
                            [99784.3, [255 * 0.135066, 255 * 0.544853, 255 * 0.554029]],
                            [99823.5, [255 * 0.133743, 255 * 0.548535, 255 * 0.553541]],
                            [99862.7, [255 * 0.132444, 255 * 0.552216, 255 * 0.553018]],
                            [99901.9, [255 * 0.131172, 255 * 0.555899, 255 * 0.552459]],
                            [99941.1, [255 * 0.129933, 255 * 0.559582, 255 * 0.551864]],
                            [99980.3, [255 * 0.128729, 255 * 0.563265, 255 * 0.551229]],
                            [100019.6, [255 * 0.127568, 255 * 0.566949, 255 * 0.550556]],
                            [100058.8, [255 * 0.126453, 255 * 0.570633, 255 * 0.549841]],
                            [100098.0, [255 * 0.125394, 255 * 0.574318, 255 * 0.549086]],
                            [100137.2, [255 * 0.124395, 255 * 0.578002, 255 * 0.548287]],
                            [100176.4, [255 * 0.123463, 255 * 0.581687, 255 * 0.547445]],
                            [100215.6, [255 * 0.122606, 255 * 0.585371, 255 * 0.546557]],
                            [100254.9, [255 * 0.121831, 255 * 0.589055, 255 * 0.545623]],
                            [100294.1, [255 * 0.121148, 255 * 0.592739, 255 * 0.544641]],
                            [100333.3, [255 * 0.120565, 255 * 0.596422, 255 * 0.543611]],
                            [100372.5, [255 * 0.120092, 255 * 0.600104, 255 * 0.542530]],
                            [100411.7, [255 * 0.119738, 255 * 0.603785, 255 * 0.541400]],
                            [100450.9, [255 * 0.119512, 255 * 0.607464, 255 * 0.540218]],
                            [100490.1, [255 * 0.119423, 255 * 0.611141, 255 * 0.538982]],
                            [100529.4, [255 * 0.119483, 255 * 0.614817, 255 * 0.537692]],
                            [100568.6, [255 * 0.119699, 255 * 0.618490, 255 * 0.536347]],
                            [100607.8, [255 * 0.120081, 255 * 0.622161, 255 * 0.534946]],
                            [100647.0, [255 * 0.120638, 255 * 0.625828, 255 * 0.533488]],
                            [100686.2, [255 * 0.121380, 255 * 0.629492, 255 * 0.531973]],
                            [100725.4, [255 * 0.122312, 255 * 0.633153, 255 * 0.530398]],
                            [100764.7, [255 * 0.123444, 255 * 0.636809, 255 * 0.528763]],
                            [100803.9, [255 * 0.124780, 255 * 0.640461, 255 * 0.527068]],
                            [100843.1, [255 * 0.126326, 255 * 0.644107, 255 * 0.525311]],
                            [100882.3, [255 * 0.128087, 255 * 0.647749, 255 * 0.523491]],
                            [100921.5, [255 * 0.130067, 255 * 0.651384, 255 * 0.521608]],
                            [100960.7, [255 * 0.132268, 255 * 0.655014, 255 * 0.519661]],
                            [101000.0, [255 * 0.134692, 255 * 0.658636, 255 * 0.517649]],
                            [101039.2, [255 * 0.137339, 255 * 0.662252, 255 * 0.515571]],
                            [101078.4, [255 * 0.140210, 255 * 0.665859, 255 * 0.513427]],
                            [101117.6, [255 * 0.143303, 255 * 0.669459, 255 * 0.511215]],
                            [101156.8, [255 * 0.146616, 255 * 0.673050, 255 * 0.508936]],
                            [101196.0, [255 * 0.150148, 255 * 0.676631, 255 * 0.506589]],
                            [101235.2, [255 * 0.153894, 255 * 0.680203, 255 * 0.504172]],
                            [101274.5, [255 * 0.157851, 255 * 0.683765, 255 * 0.501686]],
                            [101313.7, [255 * 0.162016, 255 * 0.687316, 255 * 0.499129]],
                            [101352.9, [255 * 0.166383, 255 * 0.690856, 255 * 0.496502]],
                            [101392.1, [255 * 0.170948, 255 * 0.694384, 255 * 0.493803]],
                            [101431.3, [255 * 0.175707, 255 * 0.697900, 255 * 0.491033]],
                            [101470.5, [255 * 0.180653, 255 * 0.701402, 255 * 0.488189]],
                            [101509.8, [255 * 0.185783, 255 * 0.704891, 255 * 0.485273]],
                            [101549.0, [255 * 0.191090, 255 * 0.708366, 255 * 0.482284]],
                            [101588.2, [255 * 0.196571, 255 * 0.711827, 255 * 0.479221]],
                            [101627.4, [255 * 0.202219, 255 * 0.715272, 255 * 0.476084]],
                            [101666.6, [255 * 0.208030, 255 * 0.718701, 255 * 0.472873]],
                            [101705.8, [255 * 0.214000, 255 * 0.722114, 255 * 0.469588]],
                            [101745.0, [255 * 0.220124, 255 * 0.725509, 255 * 0.466226]],
                            [101784.3, [255 * 0.226397, 255 * 0.728888, 255 * 0.462789]],
                            [101823.5, [255 * 0.232815, 255 * 0.732247, 255 * 0.459277]],
                            [101862.7, [255 * 0.239374, 255 * 0.735588, 255 * 0.455688]],
                            [101901.9, [255 * 0.246070, 255 * 0.738910, 255 * 0.452024]],
                            [101941.1, [255 * 0.252899, 255 * 0.742211, 255 * 0.448284]],
                            [101980.3, [255 * 0.259857, 255 * 0.745492, 255 * 0.444467]],
                            [102019.6, [255 * 0.266941, 255 * 0.748751, 255 * 0.440573]],
                            [102058.8, [255 * 0.274149, 255 * 0.751988, 255 * 0.436601]],
                            [102098.0, [255 * 0.281477, 255 * 0.755203, 255 * 0.432552]],
                            [102137.2, [255 * 0.288921, 255 * 0.758394, 255 * 0.428426]],
                            [102176.4, [255 * 0.296479, 255 * 0.761561, 255 * 0.424223]],
                            [102215.6, [255 * 0.304148, 255 * 0.764704, 255 * 0.419943]],
                            [102254.9, [255 * 0.311925, 255 * 0.767822, 255 * 0.415586]],
                            [102294.1, [255 * 0.319809, 255 * 0.770914, 255 * 0.411152]],
                            [102333.3, [255 * 0.327796, 255 * 0.773980, 255 * 0.406640]],
                            [102372.5, [255 * 0.335885, 255 * 0.777018, 255 * 0.402049]],
                            [102411.7, [255 * 0.344074, 255 * 0.780029, 255 * 0.397381]],
                            [102450.9, [255 * 0.352360, 255 * 0.783011, 255 * 0.392636]],
                            [102490.1, [255 * 0.360741, 255 * 0.785964, 255 * 0.387814]],
                            [102529.4, [255 * 0.369214, 255 * 0.788888, 255 * 0.382914]],
                            [102568.6, [255 * 0.377779, 255 * 0.791781, 255 * 0.377939]],
                            [102607.8, [255 * 0.386433, 255 * 0.794644, 255 * 0.372886]],
                            [102647.0, [255 * 0.395174, 255 * 0.797475, 255 * 0.367757]],
                            [102686.2, [255 * 0.404001, 255 * 0.800275, 255 * 0.362552]],
                            [102725.4, [255 * 0.412913, 255 * 0.803041, 255 * 0.357269]],
                            [102764.7, [255 * 0.421908, 255 * 0.805774, 255 * 0.351910]],
                            [102803.9, [255 * 0.430983, 255 * 0.808473, 255 * 0.346476]],
                            [102843.1, [255 * 0.440137, 255 * 0.811138, 255 * 0.340967]],
                            [102882.3, [255 * 0.449368, 255 * 0.813768, 255 * 0.335384]],
                            [102921.5, [255 * 0.458674, 255 * 0.816363, 255 * 0.329727]],
                            [102960.7, [255 * 0.468053, 255 * 0.818921, 255 * 0.323998]],
                            [103000.0, [255 * 0.477504, 255 * 0.821444, 255 * 0.318195]],
                            [103039.2, [255 * 0.487026, 255 * 0.823929, 255 * 0.312321]],
                            [103078.4, [255 * 0.496615, 255 * 0.826376, 255 * 0.306377]],
                            [103117.6, [255 * 0.506271, 255 * 0.828786, 255 * 0.300362]],
                            [103156.8, [255 * 0.515992, 255 * 0.831158, 255 * 0.294279]],
                            [103196.0, [255 * 0.525776, 255 * 0.833491, 255 * 0.288127]],
                            [103235.2, [255 * 0.535621, 255 * 0.835785, 255 * 0.281908]],
                            [103274.5, [255 * 0.545524, 255 * 0.838039, 255 * 0.275626]],
                            [103313.7, [255 * 0.555484, 255 * 0.840254, 255 * 0.269281]],
                            [103352.9, [255 * 0.565498, 255 * 0.842430, 255 * 0.262877]],
                            [103392.1, [255 * 0.575563, 255 * 0.844566, 255 * 0.256415]],
                            [103431.3, [255 * 0.585678, 255 * 0.846661, 255 * 0.249897]],
                            [103470.5, [255 * 0.595839, 255 * 0.848717, 255 * 0.243329]],
                            [103509.8, [255 * 0.606045, 255 * 0.850733, 255 * 0.236712]],
                            [103549.0, [255 * 0.616293, 255 * 0.852709, 255 * 0.230052]],
                            [103588.2, [255 * 0.626579, 255 * 0.854645, 255 * 0.223353]],
                            [103627.4, [255 * 0.636902, 255 * 0.856542, 255 * 0.216620]],
                            [103666.6, [255 * 0.647257, 255 * 0.858400, 255 * 0.209861]],
                            [103705.8, [255 * 0.657642, 255 * 0.860219, 255 * 0.203082]],
                            [103745.0, [255 * 0.668054, 255 * 0.861999, 255 * 0.196293]],
                            [103784.3, [255 * 0.678489, 255 * 0.863742, 255 * 0.189503]],
                            [103823.5, [255 * 0.688944, 255 * 0.865448, 255 * 0.182725]],
                            [103862.7, [255 * 0.699415, 255 * 0.867117, 255 * 0.175971]],
                            [103901.9, [255 * 0.709898, 255 * 0.868751, 255 * 0.169257]],
                            [103941.1, [255 * 0.720391, 255 * 0.870350, 255 * 0.162603]],
                            [103980.3, [255 * 0.730889, 255 * 0.871916, 255 * 0.156029]],
                            [104019.6, [255 * 0.741388, 255 * 0.873449, 255 * 0.149561]],
                            [104058.8, [255 * 0.751884, 255 * 0.874951, 255 * 0.143228]],
                            [104098.0, [255 * 0.762373, 255 * 0.876424, 255 * 0.137064]],
                            [104137.2, [255 * 0.772852, 255 * 0.877868, 255 * 0.131109]],
                            [104176.4, [255 * 0.783315, 255 * 0.879285, 255 * 0.125405]],
                            [104215.6, [255 * 0.793760, 255 * 0.880678, 255 * 0.120005]],
                            [104254.9, [255 * 0.804182, 255 * 0.882046, 255 * 0.114965]],
                            [104294.1, [255 * 0.814576, 255 * 0.883393, 255 * 0.110347]],
                            [104333.3, [255 * 0.824940, 255 * 0.884720, 255 * 0.106217]],
                            [104372.5, [255 * 0.835270, 255 * 0.886029, 255 * 0.102646]],
                            [104411.7, [255 * 0.845561, 255 * 0.887322, 255 * 0.099702]],
                            [104450.9, [255 * 0.855810, 255 * 0.888601, 255 * 0.097452]],
                            [104490.1, [255 * 0.866013, 255 * 0.889868, 255 * 0.095953]],
                            [104529.4, [255 * 0.876168, 255 * 0.891125, 255 * 0.095250]],
                            [104568.6, [255 * 0.886271, 255 * 0.892374, 255 * 0.095374]],
                            [104607.8, [255 * 0.896320, 255 * 0.893616, 255 * 0.096335]],
                            [104647.0, [255 * 0.906311, 255 * 0.894855, 255 * 0.098125]],
                            [104686.2, [255 * 0.916242, 255 * 0.896091, 255 * 0.100717]],
                            [104725.4, [255 * 0.926106, 255 * 0.897330, 255 * 0.104071]],
                            [104764.7, [255 * 0.935904, 255 * 0.898570, 255 * 0.108131]],
                            [104803.9, [255 * 0.945636, 255 * 0.899815, 255 * 0.112838]],
                            [104843.1, [255 * 0.955300, 255 * 0.901065, 255 * 0.118128]],
                            [104882.3, [255 * 0.964894, 255 * 0.902323, 255 * 0.123941]],
                            [104921.5, [255 * 0.974417, 255 * 0.903590, 255 * 0.130215]],
                            [104960.7, [255 * 0.983868, 255 * 0.904867, 255 * 0.136897]],
                            [105000.0, [255 * 0.993248, 255 * 0.906157, 255 * 0.143936]]
                            // [92000, [40, 0, 0]],
                            // [95000, [187, 60, 31]],
                            // [96500, [137, 32, 30]],
                            // [98000, [16, 1, 43]],
                            // [100500, [36, 1, 93]],
                            // [101300, [241, 254, 18]],
                            // [103000, [228, 246, 223]],
                            // [105000, [255, 255, 255]]
                        ])
                    }
                });
            }
        },

        "currents": {
            matches: _.matches({param: "ocean", surface: "surface", level: "currents"}),
            create: function(attr) {
                return when(catalogs.oscar).then(function(catalog) {
                    return buildProduct({
                        field: "vector",
                        type: "currents",
                        description: localize({
                            name: {en: "Ocean Currents", ja: "海流"},
                            qualifier: {en: " @ Surface", ja: " @ 地上"}
                        }),
                        paths: [oscar0p33Path(catalog, attr)],
                        date: oscarDate(catalog, attr),
                        navigate: function(step) {
                            return oscarStep(catalog, this.date, step);
                        },
                        builder: function(file) {
                            var uData = file[0].data, vData = file[1].data;
                            return {
                                header: file[0].header,
                                interpolate: bilinearInterpolateVector,
                                data: function(i) {
                                    var u = uData[i], v = vData[i];
                                    return µ.isValue(u) && µ.isValue(v) ? [u, v] : null;
                                }
                            }
                        },
                        units: [
                            {label: "m/s",  conversion: function(x) { return x; },            precision: 2},
                            {label: "km/h", conversion: function(x) { return x * 3.6; },      precision: 1},
                            {label: "kn",   conversion: function(x) { return x * 1.943844; }, precision: 1},
                            {label: "mph",  conversion: function(x) { return x * 2.236936; }, precision: 1}
                        ],
                        scale: {
                            bounds: [0, 1.5],
                            gradient: µ.segmentedColorScale([
                                [0, [10, 25, 68]],
                                [0.15, [10, 25, 250]],
                                [0.4, [24, 255, 93]],
                                [0.65, [255, 233, 102]],
                                [1.0, [255, 233, 15]],
                                [1.5, [255, 15, 15]]
                            ])
                        },
                        particles: {velocityScale: 1/4400, maxIntensity: 0.7}
                    });
                });
            }
        },

        "off": {
            matches: _.matches({overlayType: "off"}),
            create: function() {
                return null;
            }
        }
    };

    /**
     * Returns the file name for the most recent OSCAR data layer to the specified date. If offset is non-zero,
     * the file name that many entries from the most recent is returned.
     *
     * The result is undefined if there is no entry for the specified date and offset can be found.
     *
     * UNDONE: the catalog object itself should encapsulate this logic. GFS can also be a "virtual" catalog, and
     *         provide a mechanism for eliminating the need for /data/weather/current/* files.
     *
     * @param {Array} catalog array of file names, sorted and prefixed with yyyyMMdd. Last item is most recent.
     * @param {String} date string with format yyyy/MM/dd or "current"
     * @param {Number?} offset
     * @returns {String} file name
     */
    function lookupOscar(catalog, date, offset) {
        offset = +offset || 0;
        if (date === "current") {
            return catalog[catalog.length - 1 + offset];
        }
        var prefix = µ.ymdRedelimit(date, "/", ""), i = _.sortedIndex(catalog, prefix);
        i = (catalog[i] || "").indexOf(prefix) === 0 ? i : i - 1;
        return catalog[i + offset];
    }

    function oscar0p33Path(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        return file ? [OSCAR_PATH, file].join("/") : null;
    }

    function oscarDate(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    /**
     * @returns {Date} the chronologically next or previous OSCAR data layer. How far forward or backward in
     * time to jump is determined by the step and the catalog of available layers. A step of ±1 moves to the
     * next/previous entry in the catalog (about 5 days), and a step of ±10 moves to the entry six positions away
     * (about 30 days).
     */
    function oscarStep(catalog, date, step) {
        var file = lookupOscar(catalog, µ.dateToUTCymd(date, "/"), step > 1 ? 6 : step < -1 ? -6 : step);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    function dataSource(header) {
        // noinspection FallthroughInSwitchStatementJS
        switch (header.center || header.centerName) {
            case -3:
                return "OSCAR / Earth & Space Research";
            case 7:
            case "US National Weather Service, National Centres for Environmental Prediction (NCEP)":
                return "GFS / NCEP / US National Weather Service";
            default:
                return header.centerName;
        }
    }

    function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    }

    function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y;
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    /**
     * Builds an interpolator for the specified data in the form of JSON-ified GRIB files. Example:
     *
     *     [
     *       {
     *         "header": {
     *           "refTime": "2013-11-30T18:00:00.000Z",
     *           "parameterCategory": 2,
     *           "parameterNumber": 2,
     *           "surface1Type": 100,
     *           "surface1Value": 100000.0,
     *           "forecastTime": 6,
     *           "scanMode": 0,
     *           "nx": 360,
     *           "ny": 181,
     *           "lo1": 0,
     *           "la1": 90,
     *           "lo2": 359,
     *           "la2": -90,
     *           "dx": 1,
     *           "dy": 1
     *         },
     *         "data": [3.42, 3.31, 3.19, 3.08, 2.96, 2.84, 2.72, 2.6, 2.47, ...]
     *       }
     *     ]
     *
     */
    function buildGrid(builder) {
        // var builder = createBuilder(data);

        var header = builder.header;
        var λ0 = header.lo1, φ0 = header.la1;  // the grid's origin (e.g., 0.0E, 90.0N)
        var Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
        var ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)
        var date = new Date(header.refTime);
        date.setHours(date.getHours() + header.forecastTime);

        // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
        // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
        var grid = [], p = 0;
        var isContinuous = Math.floor(ni * Δλ) >= 360;
        for (var j = 0; j < nj; j++) {
            var row = [];
            for (var i = 0; i < ni; i++, p++) {
                row[i] = builder.data(p);
            }
            if (isContinuous) {
                // For wrapped grids, duplicate first column as last column to simplify interpolation logic
                row.push(row[0]);
            }
            grid[j] = row;
        }

        function interpolate(λ, φ) {
            var i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
            var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

            //         1      2           After converting λ and φ to fractional grid indexes i and j, we find the
            //        fi  i   ci          four points "G" that enclose point (i, j). These points are at the four
            //         | =1.4 |           corners specified by the floor and ceiling of i and j. For example, given
            //      ---G--|---G--- fj 8   i = 1.4 and j = 8.3, the four surrounding grid points are (1, 8), (2, 8),
            //    j ___|_ .   |           (1, 9) and (2, 9).
            //  =8.3   |      |
            //      ---G------G--- cj 9   Note that for wrapped grids, the first column is duplicated as the last
            //         |      |           column, so the index ci can be used without taking a modulo.

            var fi = Math.floor(i), ci = fi + 1;
            var fj = Math.floor(j), cj = fj + 1;

            var row;
            if ((row = grid[fj])) {
                var g00 = row[fi];
                var g10 = row[ci];
                if (µ.isValue(g00) && µ.isValue(g10) && (row = grid[cj])) {
                    var g01 = row[fi];
                    var g11 = row[ci];
                    if (µ.isValue(g01) && µ.isValue(g11)) {
                        // All four points found, so interpolate the value.
                        return builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
                    }
                }
            }
            // console.log("cannot interpolate: " + λ + "," + φ + ": " + fi + " " + ci + " " + fj + " " + cj);
            return null;
        }

        return {
            source: dataSource(header),
            date: date,
            interpolate: interpolate,
            forEachPoint: function(cb) {
                for (var j = 0; j < nj; j++) {
                    var row = grid[j] || [];
                    for (var i = 0; i < ni; i++) {
                        cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, row[i]);
                    }
                }
            }
        };
    }

    function productsFor(attributes) {
        var attr = _.clone(attributes), results = [];
        _.values(FACTORIES).forEach(function(factory) {
            if (factory.matches(attr)) {
                results.push(factory.create(attr));
            }
        });
        return results.filter(µ.isValue);
    }

    return {
        overlayTypes: d3.set(_.keys(FACTORIES)),
        productsFor: productsFor
    };

}();
