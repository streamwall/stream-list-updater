# Stream List Updater

A script to update the status of live streams listed in the [2020 George Floyd Protest Tracker](http://bit.ly/protestlinks) by [twitch.tv/woke](https://twitch.tv/woke).


## Installation

1. Run `npm install`
2. Create a [service account](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication) and grant it edit access to the sheet.


## Scripts

### Update stream spreadsheet

```
SHEET_ID=<sheets id from url> TAB_NAMES='Current Streams,Previous Streams' npm start
```

### Collect URLs from Twitch chat

```
SHEET_ID=<sheets id from url> npm run twitch-urls
```
