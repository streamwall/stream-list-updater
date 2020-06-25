# Stream List Updater

A script to update the status of live streams listed in the [2020 George Floyd Protest Tracker](http://bit.ly/protestlink) by [twitch.tv/woke](https://twitch.tv/woke).

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
* Instagram

A browser window will open and automatically load up stream URLs. You will need to fill in CAPTCHAs occasionally.


```
UPDATE_SECONDS=<age in seconds to consider check stale> CHECK_INTERVAL=<seconds between individual site checks> SLEEP_SECONDS=30 SHEETS='<sheets id from url>,<tab name 1>,<tab name 2>' PREV_STREAMS_SHEET_ID=<sheets id from url> PREV_STREAMS_TAB_NAME=<tabname> STREAM_EXPIRE_SECONDS=14400 YT_API_KEY=... IG_USER=... IG_PASS=... npm start
```

### Collect URLs from Twitch chat

```
SHEET_ID=<sheets id from url> TAB_NAME=... npm run twitch-urls
```

### Automatically publish moderated streams and announce to Discord

To set up Twitter bot:

1. Create a [new Twitter app key](https://apps.twitter.com/app/new), setting callback URL to http://localhost:3000/callback.
1. Authenticate with Twitter:
   1. Run `node ./scripts/setupTwitter.js CONSUMER_KEY CONSUMER_SECRET > ../twitter-creds.json` and open http://localhost:3000 in a web browser.
   1. Click the link and authorize your Twitter app.

```
FROM_SHEETS='<sheets id from url>,<tab name 1>,<tab name 2>' TO_SHEET_ID=<sheets id from url> TO_TAB_NAME=... FLAGGED_SHEET_ID=<sheets id from ulr> FLAGGED_TAB_NAME=... PUBLISHED_COL_NAME=... VETTED_COL_NAME=... ANNOUNCE_WEBHOOK_URL=<webhook url from discord> ANNOUNCE_DETAILS_WEBHOOK_URL=<webhook url from discord> SLEEP_SECONDS=30 npm run link-publisher
```
