const {promisify} = require('util')
const keyBy = require('lodash/keyBy')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const {GoogleSpreadsheet} = require('google-spreadsheet')
const moment = require('moment-timezone')
const puppeteer = require('puppeteer')
const {default: PQueue} = require('p-queue')

const SHEETS = process.env.SHEETS.split('|').map(s => s.split(','))
const UPDATE_SECONDS = process.env.UPDATE_SECONDS
const CREDS = require('./creds.json')
const YT_API_KEY = process.env.YT_API_KEY
const TIMEZONE = 'America/Chicago'
const DATE_FORMAT = 'M/D/YY HH:mm:ss'

const sleep = promisify(setTimeout)

class CheckError extends Error {
  constructor({captcha, retryable}, ...params) {
    super(...params)
    this.captcha = captcha
    this.retryable = retryable
  }
}

function findString(platformName, strings) {
  return async function(page, url) {
    await page.goto(url, {waitUntil: 'domcontentloaded'})
    const html = await page.content()
    if (!Array.isArray(strings)) {
      strings = [strings]
    }
    const isLive = strings.some(s => html.includes(s))
    const $ = cheerio.load(html)
    const title = $('title').text()
    return {url, isLive, html, title, platformName}
  }
}

const checkPeriscopeLive = findString('Periscope', `name="twitter:text:broadcast_state" content="RUNNING"`)
const checkInstagramLive = findString('Instagram', `"broadcast_status":"active"`)

const checkTwitchLive = async function(page, url) {
  const platformName = 'Twitch'
  await page.goto(url, {waitUntil: 'load'})
  const liveIndicator$ = await page.$('.live-indicator, .live-indicator-container')
  const isLive = !!liveIndicator$
  const title$ = await page.$('[data-a-target=stream-title]')
  let title
  if (title$) {
    title = await title$.evaluate(n => n.textContent)
  }
  return {url, isLive, title, platformName}
}

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
  const result = await findString('Facebook', [`"broadcast_status":"LIVE"`, 'is_live_stream:true,'])(page, url)
  if (result.title === 'Security Check Required') {
    throw new CheckError({captcha: true, retryable: true}, 'Facebook CAPTCHA required')
  } else if (result.html.includes(`This Content Isn't Available Right Now`)) {
    result.isLive = false
  } else if (result.html.includes('You must log in to continue')) {
    result.isLive = false
  } else if (!result.html.includes('broadcast_status')) {
    throw new CheckError({retryable: true}, 'Facebook returned unexpected response')
  }
  result.embed = `https://www.facebook.com/plugins/video.php?href=${url}&show_text=0`
  return result
}

function checkForStream(url) {
  let {host} = new URL(url)
  host = host.replace(/^www\./, '')

  if (YT_API_KEY && (host === 'youtube.com' || host === 'youtu.be')) {
    return checkYTLive
  } else if (host === 'facebook.com') {
    return checkFBLive
  } else if (host === 'twitch.tv') {
    return checkTwitchLive
  } else if (host === 'periscope.tv' || host === 'pscp.tv') {
    return checkPeriscopeLive
  } else if (host === 'instagram.com') {
    return checkInstagramLive
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

  if (result.status) {
    row.Status = result.status
  } else {
    row.Status = result.isLive ? 'Live' : 'Offline'
  }
  row['Last Checked (CST)'] = moment().tz(TIMEZONE).format(DATE_FORMAT)
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

  let page

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
          await sleep(5000)
          await page.waitForNavigation({timeout: 2 * 60 * 1000})
        }
        if (!err.retryable || tries > 3) {
          console.warn('giving up on row', row && row.Link)
          return
        }
        queue.add(tryRow(sheet, offset, tries + 1))
        return
      }
      console.log('updated', row.Link, row.Status, `(remaining: ${queue.size})`)
    }
  }

  for (const sheet of SHEETS) {
    const [sheetID, ...tabNames] = sheet

    const doc = new GoogleSpreadsheet(sheetID)
    await doc.useServiceAccountAuth(CREDS)
    await doc.loadInfo()
  
    const sheets = Object.values(doc.sheetsById).filter(s => tabNames.includes(s.title))
    for (const sheet of sheets) {
      const rows = await sheet.getRows()
      for (const [offset, row] of rows.entries()) {
        if (row.Source === '🤖 Bot enabled:' && row.Platform !== 'YES') {
          console.log('bot disabled. skipping sheet.')
          break
        }
        if (!row.Link || !checkForStream(row.Link)) {
          continue
        }
        if (row['Last Checked (CST)']) {
          const lastUpdate = moment.tz(row['Last Checked (CST)'], DATE_FORMAT, TIMEZONE)
          if (lastUpdate.isAfter(moment().subtract(UPDATE_SECONDS, 'seconds'))) {
            console.log('skipping recently updated', row.Link)
            continue
          }
        }
        queue.add(tryRow(sheet, offset))
      }
    }
  }

  if (queue.size === 0) {
    console.log('nothing to do.')
    return
  }

  const browser = await puppeteer.launch({headless: false})
  page = await browser.newPage()

  queue.start()
  await queue.onIdle()
  console.log('finished.')
  await browser.close()
}

main()
