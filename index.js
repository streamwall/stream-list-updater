const {promisify} = require('util')
const keyBy = require('lodash/keyBy')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const {GoogleSpreadsheet} = require('google-spreadsheet')
const moment = require('moment-timezone')
const puppeteer = require('puppeteer')
const {default: PQueue} = require('p-queue')

const SHEETS = process.env.SHEETS.split('|').map(s => s.split(','))
const CREDS = require('./creds.json')
const YT_API_KEY = process.env.YT_API_KEY

const sleep = promisify(setTimeout)

class CheckError extends Error {
  constructor({captcha, retryable}, ...params) {
    super(...params)
    this.captcha = captcha
    this.retryable = retryable
  }
}

function findString(platformName, string) {
  return async function(page, url) {
    await page.goto(url, {waitUntil: 'domcontentloaded'})
    const html = await page.content()
    const isLive = html.includes(string)
    const $ = cheerio.load(html)
    const title = $('title').text()
    return {url, isLive, html, title, platformName}
  }
}

const checkTwitchLive = findString('Twitch', `"isLiveBroadcast":true`)
const checkPeriscopeLive = findString('Periscope', `name="twitter:text:broadcast_state" content="RUNNING"/>`)

const checkYTLive = async function(page, url) {
  const platformName = 'YouTube'
  const ytID = url.startsWith('https://youtu.be') ? url.split('youtu.be/')[1] : url.split('v=')[1]
  const apiURL = `https://www.googleapis.com/youtube/v3/videos?id=${ytID}&key=${YT_API_KEY}&part=snippet`
  const resp = await fetch(apiURL)
  const data = await resp.json()
  const firstItem = data.items[0]
  const isLive = firstItem && firstItem.snippet.liveBroadcastContent === 'live'
  const title = firstItem && firstItem.snippet.title
  const embed = `https://www.youtube.com/embed/${ytID}`
  const result = {url, isLive, title, platformName, embed}
  return result
}

const checkFBLive = async function(page, url) {
  const result = await findString('Facebook', `"broadcast_status":"LIVE"`)(page, url)
  if (result.title === 'Security Check Required') {
    throw new CheckError({captcha: true, retryable: true}, 'Facebook CAPTCHA required')
  }
  if (!result.html.includes('broadcast_status')) {
    throw new CheckError({retryable: true}, 'Facebook returned unexpected response')
  }
  if (result.title === 'You must log in to continue') {
    throw new CheckError('Facebook content now private')
  }
  result.embed = `https://www.facebook.com/plugins/video.php?href=${url}&show_text=0`
  return result
}

function checkForStream(url) {
  if (YT_API_KEY && (url.startsWith('https://www.youtube.com') || url.startsWith('https://youtu.be'))) {
    return checkYTLive
  } else if (url.startsWith('https://www.facebook.com')) {
    return checkFBLive
  } else if (url.startsWith('https://www.twitch.tv')) {
    return checkTwitchLive
  } else if (url.startsWith('https://www.periscope.tv') || url.startsWith('https://www.pscp.tv')) {
    return checkPeriscopeLive
  }
}

async function getRow(sheet, offset) {
  const rows = await sheet.getRows({offset, limit: 1})
  return rows[0]
}

async function updateRow(row, page) {
  const {Link} = row

  const check = checkForStream(row.Link)
  if (!check) {
    return
  }

  const result = await check(page, row.Link)

  row.Status = result.isLive ? 'Live' : 'Offline'
  row['Last Checked (CST)'] = moment().tz("America/Chicago").format('M/D/YY HH:mm:ss')
  if (result.isLive) {
    row['Title'] = result.title
  }
  if (result.embed) {
    row['Embed Link'] = result.embed
  }
  return row
}

async function main() {
  const queue = new PQueue({concurrency: 1, interval: 2000, intervalCap: 1, autoStart: false})

  const browser = await puppeteer.launch({headless: false})
  const page = await browser.newPage()

  function tryRow(sheet, offset, tries=0) {
    return async function() {
      await sleep(tries * 5000)

      try {
        row = await getRow(sheet, offset)
        if (!row || !row.Link) {
          return
        }

        await updateRow(row, page)

        // Verify that row is untouched before updating it
        const checkRow = await getRow(sheet, offset)
        if (!checkRow || checkRow.Link !== row.Link) {
          console.log('row modified, skipping', row.Link)
          return
        }
        await row.save()
      } catch (err) {
        if (err.response && err.response.status === 429) {
          queue.pause()
          console.log('ratelimited. waiting 5s...')
          await sleep(10000)
          queue.start()
	  return
        }

        console.warn('error updating row', row && row.Link, err)
	if (err.captcha) {
	  console.log('waiting for captcha...')
	  await page.waitForNavigation({timeout: 2 * 60 * 1000})
	}
        if (!err.retryable || tries > 3) {
          console.warn('giving up on row', row && row.Link)
          return
        }
        queue.add(tryRow(sheet, offset, tries + 1))
        return
      }
      console.log('updated', row.Link, 'remaining', queue.size)
    }
  }

  for (const sheet of SHEETS) {
    const [sheetID, ...tabNames] = sheet

    const doc = new GoogleSpreadsheet(sheetID)
    await doc.useServiceAccountAuth(CREDS)
    await doc.loadInfo()
  
    const sheets = Object.values(doc.sheetsById).filter(s => tabNames.includes(s.title))
    for (const sheet of sheets) {
      // The header row is included in the row count but not the offset
      const rowCount = sheet.rowCount - 1
      for (let offset = 0; offset < rowCount; offset++) {
        queue.add(tryRow(sheet, offset))
      }
    }
  }

  queue.start()
  await queue.onIdle()
  console.log('finished.')
  await browser.close()
}

main()
