const {promisify} = require('util')
const keyBy = require('lodash/keyBy')
const cheerio = require('cheerio')
const {GoogleSpreadsheet} = require('google-spreadsheet')
const moment = require('moment-timezone')
const fetch = require('node-fetch')
const {default: PQueue} = require('p-queue')

const SHEET_ID = process.env.SHEET_ID
const TAB_NAMES = process.env.TAB_NAMES.split(',')
const CREDS = require('./creds.json')

const sleep = promisify(setTimeout)

function findString(platformName, string) {
  return async function (url) {
    const res = await fetch(url)
    const text = await res.text()
    const isLive = text.includes(string)
    const $ = cheerio.load(text)
    const title = $('title').text()
    return {url, isLive, title, platformName}
  }
}

const checkYTLive = findString('YouTube', `liveStreamability`)
const checkFBLive = findString('Facebook', `"broadcast_status":"LIVE"`)
const checkTwitchLive = findString('Twitch', `"isLiveBroadcast":true`)
const checkPeriscopeLive = findString('Periscope', `name="twitter:text:broadcast_state" content="RUNNING"/>`)

function checkForStream(url) {
  if (url.startsWith('https://www.youtube.com') || url.startsWith('https://youtu.be')) {
    return checkYTLive
  } else if (url.startsWith('https://www.facebook.com')) {
    return checkFBLive
  } else if (url.startsWith('https://www.twitch.tv')) {
    return checkTwitchLive
  } else if (url.startsWith('https://www.periscope.tv') || url.startsWith('https://www.pscp.tv')) {
    return checkPeriscopeLive
  }
}

async function updateRow(row) {
  const {Link} = row
  const check = checkForStream(row.Link)
  if (!check) {
    return
  }

  const result = await check(row.Link)

  row.Status = result.isLive ? 'Live' : 'Offline'
  row['Last Checked (CST)'] = moment().tz("America/Chicago").format('M/DD/YY HH:mm:ss')
  if (result.isLive) {
    row['Title'] = result.title
  }
  await row.save()
}

async function main() {
  const doc = new GoogleSpreadsheet(SHEET_ID)
  await doc.useServiceAccountAuth(CREDS)
  await doc.loadInfo()

  const sheets = Object.values(doc.sheetsById).filter(s => TAB_NAMES.includes(s.title))

  const queue = new PQueue({concurrency: 10, autoStart: false})

  function tryRow(row, tries=0) {
    return async function() {
      await sleep(tries * 5000)
      try {
        await updateRow(row)
      } catch (err) {
        if (err.response && err.response.status === 429) {
          queue.pause()
          console.log('ratelimited. waiting 5s...')
          await sleep(10000)
          queue.start()
        } else {
          console.warn('error updating row', row.Link, err.toString())
        }

        if (tries > 3) {
          console.warn('giving up on row', row.Link)
          return
        }
        queue.add(tryRow(row, tries + 1))
      }
      console.log('updated', row.Link)
    }
  }

  for (const sheet of sheets) {
    const rows = await sheet.getRows()
    for (const row of rows) {
      if (!row.Link) {
        continue
      }
      queue.add(tryRow(row))
    }
  }

  queue.start()
  await queue.onIdle()
  console.log('finished.')
}

main()
