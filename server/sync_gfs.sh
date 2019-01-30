#!/bin/bash
SERVER_DIR="/home/disk/ivanova2/weather-flow/server"

cd $SERVER_DIR
mkdir -p ../tmp

# Fetch previous 6 hours (-b 6) and next 2 forecast times starting with f000 (-d 2)
node gfs-update.js -g "../scratch" -l "../public/data/weather" -p "ftp" -f recent -b 6 -d 40

# Drop unwanted forecasts from 21 days ago
# if this script fails for some period of time, will have to go back and delete manually
echo "Trying to remove forecasts from 21 days ago"
let "oldDate = `date -ud '21 days ago' +"%Y%m%d"`"
fileMask="../scratch/gfs.$oldDate*/gfs.t*z.pgrb2.*p*."
rm ${fileMask}f006
rm ${fileMask}f009
rm ${fileMask}f01*
rm ${fileMask}f02*
rm ${fileMask}f03*
rm ${fileMask}f04*
rm ${fileMask}f05*
rm ${fileMask}f06*
rm ${fileMask}f07*
rm ${fileMask}f08*
rm ${fileMask}f09*
rm ${fileMask}f1*

# Cleanup tmp
rmdir ../tmp
