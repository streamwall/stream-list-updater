# Stream List Updater

A script to update the status of live streams listed in the [2020 George Floyd Protest Tracker](http://bit.ly/protestlinks) by [twitch.tv/woke](https://twitch.tv/woke).

These tools use HTML scraping and hacks to get rapid information out of streaming websites with heterogeneous APIs. The methods employed will become stale over time.


## Installation / Setup

1. Run `npm install`
2. Create a [service account](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication) and grant it edit access to the sheet.
3. Save the service account JSON key as "creds.json" in this directory.
4. Get a [YouTube API Key](https://developers.google.com/youtube/v3/getting-started) if you'd like to monitor YouTube live streams.


## Scripts

### Update stream spreadsheet

This script checks links in the spreadsheet to determine if streams are live or offline. It works for the following services:

* YouTube (requires API key)
* Facebook Live
* Twitch.tv
* Periscope

A browser window will open and automatically load up stream URLs. You will need to fill in CAPTCHAs occasionally.


```
SHEETS='<sheets id from url>,<tab name 1>,<tab name 2>' YT_API_KEY=... npm start
```

### Collect URLs from Twitch chat

```
SHEET_ID=<sheets id from url> npm run twitch-urls
```
