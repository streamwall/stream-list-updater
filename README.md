# Stream List Updater

A script to update the status of live streams listed in the [2020 George Floyd Protest Tracker](http://bit.ly/protestlinks) by [twitch.tv/woke](https://twitch.tv/woke).

These tools use HTML scraping and hacks to get rapid information out of streaming websites with heterogeneous APIs. The methods employed will become stale over time.


## Installation

1. Run `npm install`
2. Create a [service account](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication) and grant it edit access to the sheet.


## Scripts

### Update stream spreadsheet

A browser window will open and automatically load up stream URLs. You will need to fill in CAPTCHAs occasionally.


```
SHEETS='<sheets id from url>,<tab name 1>,<tab name 2>' npm start
```

### Collect URLs from Twitch chat

```
SHEET_ID=<sheets id from url> npm run twitch-urls
```
