# Fetch previous day, next 72 hour forecast period
node gfs-update.js -g "../scratch" -l "../public/data/weather" -p "ftp" -f now -b 24 -d 24
# Push current
node gfs-update.js -g "../scratch" -l "../public/data/weather" -p "ftp"

# TODO: Drop unwanted forecasts from previous weeks/months
