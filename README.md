earth
=====

**NOTE: the location of `dev-server.js` has changed from `{repository}/server/` to `{repository}/`**

"earth" is a project to visualize global weather conditions.

A customized instance of "earth" is available at http://earth.nullschool.net.

"earth" is a personal project I've used to learn javascript and browser programming, and is based on the earlier
[Tokyo Wind Map](https://github.com/cambecc/air) project.  Feedback and contributions are welcome! ...especially
those that clarify accepted best practices.

building and launching
----------------------

After installing node.js and npm, clone "earth" and install dependencies:

    git clone https://github.com/cambecc/earth
    cd earth
    npm install

Next, launch the development web server:

    node dev-server.js 8080

Finally, point your browser to:

    http://localhost:8080

The server acts as a stand-in for static S3 bucket hosting and so contains almost no server-side logic. It
serves all files located in the `earth/public` directory. See `public/index.html` and `public/libs/earth/*.js`
for the main entry points. Data files are located in the `public/data` directory, and there is one sample
weather layer located at `data/weather/current`.

*For Ubuntu, Mint, and elementary OS, use `nodejs` instead of `node` instead due to a [naming conflict](https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager#ubuntu-mint-elementary-os).

getting map data
----------------

Map data is provided by [Natural Earth](http://www.naturalearthdata.com) but must be converted to
[TopoJSON](https://github.com/mbostock/topojson/wiki) format. We make use of a couple different map scales: a
simplified, larger scale for animation and a more detailed, smaller scale for static display. After installing
[GDAL](http://www.gdal.org/) and TopoJSON (see [here](http://bost.ocks.org/mike/map/#installing-tools)), the
following commands build these files:

    curl "http://www.nacis.org/naturalearth/50m/physical/ne_50m_coastline.zip" -o ne_50m_coastline.zip
    curl "http://www.nacis.org/naturalearth/50m/physical/ne_50m_lakes.zip" -o ne_50m_lakes.zip
    curl "http://www.nacis.org/naturalearth/110m/physical/ne_110m_coastline.zip" -o ne_110m_coastline.zip
    curl "http://www.nacis.org/naturalearth/110m/physical/ne_110m_lakes.zip" -o ne_110m_lakes.zip
    unzip -o ne_\*.zip
    ogr2ogr -f GeoJSON coastline_50m.json ne_50m_coastline.shp
    ogr2ogr -f GeoJSON coastline_110m.json ne_110m_coastline.shp
    ogr2ogr -f GeoJSON -where "scalerank < 4" lakes_50m.json ne_50m_lakes.shp
    ogr2ogr -f GeoJSON -where "scalerank < 2 AND admin='admin-0'" lakes_110m.json ne_110m_lakes.shp
    ogr2ogr -f GeoJSON -simplify 1 coastline_tiny.json ne_110m_coastline.shp
    ogr2ogr -f GeoJSON -simplify 1 -where "scalerank < 2 AND admin='admin-0'" lakes_tiny.json ne_110m_lakes.shp
    topojson -o earth-topo.json coastline_50m.json coastline_110m.json lakes_50m.json lakes_110m.json
    topojson -o earth-topo-mobile.json coastline_110m.json coastline_tiny.json lakes_110m.json lakes_tiny.json
    cp earth-topo*.json <earth-git-repository>/public/data/

getting weather data
--------------------

Weather data is produced by the [Global Forecast System](http://en.wikipedia.org/wiki/Global_Forecast_System) (GFS),
operated by the US National Weather Service. Forecasts are produced four times daily and made available for
download from [NOMADS](http://nomads.ncep.noaa.gov/). The files are in [GRIB2](http://en.wikipedia.org/wiki/GRIB)
format and contain over [300 records](http://www.nco.ncep.noaa.gov/pmb/products/gfs/gfs.t00z.pgrbf00.grib2.shtml).
We need only a few of these records to visualize wind data at a particular isobar. The following commands download
the 1000 hPa wind vectors and convert them to JSON format using the [grib2json](https://github.com/cambecc/grib2json)
utility:

    YYYYMMDD=<a date, for example: 20140101>
    curl "http://nomads.ncep.noaa.gov/cgi-bin/filter_gfs.pl?file=gfs.t00z.pgrb2.1p00.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&dir=%2Fgfs.${YYYYMMDD}00" -o gfs.t00z.pgrb2.1p00.f000
    grib2json -d -n -o current-wind-surface-level-gfs-1.0.json gfs.t00z.pgrb2.1p00.f000
    cp current-wind-surface-level-gfs-1.0.json <earth-git-repository>/public/data/weather/current

data fetching
---------------

The utilities to sync weather data have been resurrected from the original [earth](https://github.com/cambecc/earth) and built upon.  There is now the ability to push data to an FTP site. 
**Some pre-reqs for automatic updates**
  * You'll need the [grib2json](https://github.com/cambecc/grib2json) utility in order to run either `gfs-update.js` or `oscar-update.js` in the `server` directory.  The grib2json README is a bit sparse so here's some steps to aid
    1. Clone the repo and `cd` into it
    2. First, you will need Apache Maven (mvn). Check to see if you already have it installed by running 

            mvn -v

        If it is installed you should see details of the mvn version and configuration.  Visit the [mvn download page](https://maven.apache.org/download.cgi) to install it if you do not have it.
        
        Once installed, you'll want to verify that the Java kit being referenced as the Java Home is a JDK and not a JRE.  This info will be in the output from running the command above.  e.g.
        
            Apache Maven 3.5.2 (138edd61fd100ec658bfa2d307c43b76940a5d7d; 2017-10-18T03:58:13-04:00)
            Maven home: /opt/apache-maven
            Java version: 9.0.4, vendor: Oracle Corporation
            Java home: /home/disk/ivanova2/spencerwork/jdk-9.0.4
            Default locale: en_US, platform encoding: UTF-8
            OS name: "linux", version: "2.6.32-358.6.1.el6.centos.plus.x86_64", arch: "amd64", family: "unix"
            
        Notice the **Java home** line, where my server is referencing a local JDK install.  
    3. Build the grib2json utility by running this command in the project root directory
    
            mvn package
            
        If successful, you should end up with a `grib2json-*-SNAPSHOT.tar.gz` file in the grib2json `target` directory.
            
    4. Expand the tar file produced in `target`
        
            tar -xvf grib2json-0.8.0-SNAPSHOT.tar.gz
            
    5. In the snapshot folder you just expanded, you should have `bin` and `lib` directories.  The `bin` directory contains the grib2json commands.  Set the `G2J_PATH` in your own `private/server-config.json` to the full path to the `bin` directory.
    
    6. Once you have your server config file with the `G2J_PATH` defined, you should be ready to run commands such as:
    
            node gfs-update.js -g ../scratch -l ../public/data/weather -f now -u 2018-01-01 -p ftp -d 24
            
        Which would fetch the layers defined in `LAYER_RECIPES` of `gfs-update.js` for the current forecast (out to 72 hours) and for the previous analyses back to 2018-01-01.
        

Automatic retrieval can then be used by setting up a root crontab such as

    0 2-23/3 * * * cd /path/to/project/server && sudo -u yourusername "./sync_gfs.sh"
    
_runs every 3 hours beginning at 0200 local time_

making sure to set `/path/to/project` to be your project's root path, and `yourusername` for whatever user you want to run the sync command as (if you don't want to run as root).

font subsetting
---------------

This project uses [M+ FONTS](http://mplus-fonts.sourceforge.jp/). To reduce download size, a subset font is
constructed out of the unique characters utilized by the site. See the `earth/server/font/findChars.js` script
for details. Font subsetting is performed by the [M+Web FONTS Subsetter](http://mplus.font-face.jp/), and
the resulting font is placed in `earth/public/styles`.

[Mono Social Icons Font](http://drinchev.github.io/monosocialiconsfont/) is used for scalable, social networking
icons. This can be subsetted using [Font Squirrel's WebFont Generator](http://www.fontsquirrel.com/tools/webfont-generator).

implementation notes
--------------------

Building this project required solutions to some interesting problems. Here are a few:

   * The GFS grid has a resolution of 1°. Intermediate points are interpolated in the browser using [bilinear
     interpolation](http://en.wikipedia.org/wiki/Bilinear_interpolation). This operation is quite costly.
   * Each type of projection warps and distorts the earth in a particular way, and the degree of distortion must
     be calculated for each point (x, y) to ensure wind particle paths are rendered correctly. For example,
     imagine looking at a globe where a wind particle is moving north from the equator. If the particle starts
     from the center, it will trace a path straight up. However, if the particle starts from the globe's edge,
     it will trace a path that curves toward the pole. [Finite difference approximations](http://gis.stackexchange.com/a/5075/23451)
     are used to estimate this distortion during the interpolation process.
   * The SVG map of the earth is overlaid with an HTML5 Canvas, where the animation is drawn. Another HTML5
     Canvas sits on top and displays the colored overlay. Both canvases must know where the boundaries of the
     globe are rendered by the SVG engine, but this pixel-for-pixel information is difficult to obtain directly
     from the SVG elements. To workaround this problem, the globe's bounding sphere is re-rendered to a
     detached Canvas element, and the Canvas' pixels operate as a mask to distinguish points that lie outside
     and inside the globe's bounds.
   * Most configuration options are persisted in the hash fragment to allow deep linking and back-button
     navigation. I use a [backbone.js Model](http://backbonejs.org/#Model) to represent the configuration.
     Changes to the model persist to the hash fragment (and vice versa) and trigger "change" events which flow to
     other components.
   * Components use [backbone.js Events](http://backbonejs.org/#Events) to trigger changes in other downstream
     components. For example, downloading a new layer produces a new grid, which triggers reinterpolation, which
     in turn triggers a new particle animator. Events flow through the page without much coordination,
     sometimes causing visual artifacts that (usually) quickly disappear.
   * There's gotta be a better way to do this. Any ideas?

inspiration
-----------

The awesome [hint.fm wind map](http://hint.fm/wind/) and [D3.js visualization library](http://d3js.org) provided
the main inspiration for this project.
