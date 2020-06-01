# Stream List Updater

A script to update the status of live streams listed in the [2020 George Floyd Protest Tracker](http://bit.ly/protestlinks) by [twitch.tv/woke](https://twitch.tv/woke).

These tools use HTML scraping and hacks to get rapid information out of streaming websites with heterogeneous APIs. The methods employed will become stale over time.


## Installation

1. Run `npm install`
2. Create a [service account](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication) and grant it edit access to the sheet.


## Scripts

### Saving cookies

Some streaming sites will return CAPTCHA security checks due to the frequency of requests. Solving these CAPTCHAs manually can help, as can signing in on these sites. Both require saving cookies.

To add cookies to the "cookie jar" used for making requests:

```
npm run save-cookies 'https://www.website.com' 'cookie1; cookie2; cookie3'
```

You can get a list of these cookies by grabbing the `Cookie` field from a request in a browser network inspector.


### Update stream spreadsheet

```
SHEET_ID=<sheets id from url> TAB_NAMES='Current Streams,Previous Streams' npm start
```

### Collect URLs from Twitch chat

```
SHEET_ID=<sheets id from url> npm run twitch-urls
```
