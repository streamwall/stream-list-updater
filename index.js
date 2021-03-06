#!/usr/bin/env node
const fs = require('fs');
const keyBy = require('lodash/keyBy')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const {GoogleSpreadsheet} = require('google-spreadsheet')
const moment = require('moment-timezone')
const puppeteer = require('puppeteer')
const devices = require('puppeteer/DeviceDescriptors')
const iPhoneX = devices.devicesMap['iPhone X']
const {default: PQueue} = require('p-queue')
const slugify = require('@sindresorhus/slugify');

const SHEETS = process.env.SHEETS.split('|').map(s => s.split(','))
const PREV_STREAMS_SHEET_ID = process.env.PREV_STREAMS_SHEET_ID
const PREV_STREAMS_TAB_NAME = process.env.PREV_STREAMS_TAB_NAME
const STREAM_EXPIRE_SECONDS = process.env.STREAM_EXPIRE_SECONDS
const UPDATE_SECONDS = process.env.UPDATE_SECONDS
const CHECK_INTERVAL = process.env.CHECK_INTERVAL * 1000
const SHEET_CREDS = require('./gs-creds.json')
const YT_API_KEY = process.env.YT_API_KEY
const IG_USER = process.env.IG_USER
const IG_PASS = process.env.IG_PASS
const TIMEZONE = 'America/Chicago'
const DATE_FORMAT = 'M/D/YY HH:mm:ss'
const SLEEP_SECONDS = process.env.SLEEP_SECONDS

const {sleep, getStreamType, getLinkInfo, getSheetTab, reverseEntries} = require('./utils')

class CheckError extends Error {
  constructor({captcha, retryable}, ...params) {
    super(...params)
    this.captcha = captcha
    this.retryable = retryable
  }
}

function findString(streamType, strings) {
  return async function(page, url) {
    await page.goto(url, {waitUntil: 'domcontentloaded'})
    const html = await page.content()
    if (!Array.isArray(strings)) {
      strings = [strings]
    }
    const isLive = strings.some(s => html.includes(s))
    const $ = cheerio.load(html)
    const title = $('title').text()
    return {url, isLive, html, title, streamType}
  }
}

const checkPeriscopeLive = findString('Periscope', `name="twitter:text:broadcast_state" content="RUNNING"`)

const checkInstagramLive = async function(page, url) {
  const streamType = 'Instagram'
  await page.goto(url)

  const loggedOut$ = await page.$('html.not-logged-in', {waitUntil: 'network0'})
  if (loggedOut$) {
    await page.waitFor('[name=username]')
    await page.type('[name=username]', IG_USER)
    await page.type('[name=password]', IG_PASS)
    await page.click('[type=submit]')
    await page.waitForNavigation()
  }
  const stillLoggedOut$ = await page.$('html.not-logged-in')
  if (stillLoggedOut$) {
    throw new CheckError({retryable: false}, 'Unable to log in to Instagram')
  }

  const html = await page.content()
  const isLive = html.includes(`"broadcast_status":"active"`)
  return {url, isLive, html, streamType}
}

const checkTwitchLive = async function(page, url) {
  const streamType = 'Twitch'
  const {channelName, embed} = await getLinkInfo(url)
  await page.goto(url, {waitUntil: 'load'})
  const liveIndicator$ = await page.$('.live-indicator, .live-indicator-container')
  const isLive = !!liveIndicator$
  const title$ = await page.$('[data-a-target=stream-title]')
  let title
  if (title$) {
    title = await title$.evaluate(n => n.textContent)
  }
  return {url, isLive, title, streamType, embed}
}

const checkYTLive = async function(page, url) {
  const streamType = 'YouTube'
  const {videoID, embed} = await getLinkInfo(url)
  const apiURL = `https://www.googleapis.com/youtube/v3/videos?id=${videoID}&key=${YT_API_KEY}&part=snippet`
  const resp = await fetch(apiURL)
  const data = await resp.json()
  const firstItem = data.items[0]
  const isLive = firstItem && firstItem.snippet.liveBroadcastContent === 'live'
  const title = firstItem && firstItem.snippet.title
  const result = {url, isLive, title, streamType, embed}
  return result
}

const checkFBLive = async function(page, url) {
  const streamType = 'Facebook'

  async function getDataFromH3(page) {
    const selector = 'h3[data-gt=\'{"tn":"C"}\']'
    let source = ''
    let isLive = false

    await page.waitForSelector(selector)
    const h3El = await page.$(selector)
    if(!h3El) {
      return { name: '', isLive: false }
    }

    const re = /(.*) (is|was) live/i
    const text = await page.$eval(selector, e => { return e.innerText })

    if (re.test(text)) {
      const matchData = text.match(re)
      source = matchData[1]
      isLive = matchData[2] === 'is'
    }

    return { source, isLive }
  }

  async function getTitle(page) {
    const title$ = await page.$('.story_body_container > div > p')
    let title
    if (title$) {
      title = await title$.evaluate(n => n.textContent)
    }
  }

  await page.emulate(iPhoneX);
  await page.goto(url)
  const {source, isLive} = await getDataFromH3(page)
  const title = await getTitle(page)
  const {embed} = await getLinkInfo(url)

  return {url, isLive, title, streamType, embed, source}
}

function checkForStream(url) {
  const streamType = getStreamType(url)
  if (YT_API_KEY && streamType === 'YouTube') {
    return checkYTLive
  } else if (streamType === 'Facebook') {
    return checkFBLive
  } else if (streamType === 'Twitch') {
    return checkTwitchLive
  } else if (streamType === 'Periscope') {
    return checkPeriscopeLive
  } else if (streamType === 'Instagram') {
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

  const timestamp = moment().tz(TIMEZONE).format(DATE_FORMAT)
  row['Last Checked (CST)'] = timestamp
  if (result.isLive || !row['Last Live (CST)']) {
    row['Last Live (CST)'] = timestamp
  }

  if (result.isLive) {
    row['Title'] = result.title
  }
  if (result.embed) {
    row['Embed Link'] = result.embed
  }
  return row
}

async function runUpdate() {
  const queue = new PQueue({concurrency: 1, interval: CHECK_INTERVAL, intervalCap: 1, autoStart: false})
  const browser = await puppeteer.launch({headless: false})

  const prevStreamsSheet = await getSheetTab(SHEET_CREDS, PREV_STREAMS_SHEET_ID, PREV_STREAMS_TAB_NAME)

  async function getCookiePath(url) {
    const streamType = getStreamType(url)
    let cookieSlug = url
    try {
      cookieSlug = slugify(streamType)
    } catch {
      console.log("Could not generate cookie file slug for url; slugifying URL: ", url)
      return `./cookies-${slugify(url)}.json`
    }
    return `./cookies-${cookieSlug}.json`
  }

  async function saveCookies(page) {
    if (!page || page.url() === 'about:blank') {
      return
    }
    const cookiePath = await getCookiePath(page.url())
    const cookies = await page.cookies();
    await fs.promises.writeFile(cookiePath, JSON.stringify(cookies, null, 2));
  }

  async function loadCookies(page, url) {
    if (!page) {
      return
    }
    const cookiePath = await getCookiePath(url)
    if (fs.existsSync(cookiePath)) {
      const cookiesString = await fs.promises.readFile(cookiePath);
      const cookies = JSON.parse(cookiesString);
      await page.setCookie(...cookies);
    }
  }

  function enqueue(promise) {
    queue.add(promise).catch(err => {
      console.error('unhandled fatal error', err)
      process.exit(1)
    })
  }

  function tryRow(sheet, offset, tries=0) {
    return async function() {
      await sleep(tries * 5000)

      const page = await browser.newPage()

      let row
      try {
        row = await getRow(sheet, offset)
        if (!row || !row.Link) {
          return
        }

        await loadCookies(page, row.Link)
        await updateRow(row, page)

        // Verify that row is untouched before updating it
        const checkRow = await getRow(sheet, offset)
        if (!checkRow || checkRow.Link !== row.Link) {
          console.log('row modified, skipping', row.Link)
          return
        }

        if (row['Last Live (CST)']) {
          const lastLive = moment.tz(row['Last Live (CST)'], DATE_FORMAT, TIMEZONE)
          if (lastLive.isBefore(moment().subtract(STREAM_EXPIRE_SECONDS, 'seconds'))) {
            console.log('expiring row', row.Link)
            await prevStreamsSheet.addRow(row)
            await row.delete()
            await saveCookies(page)
            return
          }
        }
        await row.save()
      } catch (err) {
        if (err.response && err.response.status === 429) {
          queue.pause()
          console.log('ratelimited. waiting 10s...')
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
        enqueue(tryRow(sheet, offset, tries + 1))
        return
      } finally {
        if (page && !page.isClosed()) {
          await saveCookies(page)
          await page.close()
        }
      }
      console.log('updated', row.Link, row.Status, `(remaining: ${queue.size})`)
    }
  }

  for (const docInfo of SHEETS) {
    const [sheetID, ...tabNames] = docInfo

    const doc = new GoogleSpreadsheet(sheetID)
    await doc.useServiceAccountAuth(SHEET_CREDS)
    await doc.loadInfo()

    const sheets = Object.values(doc.sheetsById).filter(s => tabNames.includes(s.title))
    const processedLinks = new Set()
    for (const sheet of sheets) {
      const rows = await sheet.getRows()
      for (const [offset, row] of reverseEntries(rows)) {
        // Skip duplicates
        if(processedLinks.has(row.Link)) {
          console.log(`Found duplicate source ${row.Link}`)
          continue
        }
        processedLinks.add(row.Link)

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
        if (row['Disable Status Checks']) {
          console.log('skipping disabled row', row.Link)
          continue
        }
        enqueue(tryRow(sheet, offset))
      }
    }
  }

  if (queue.size === 0) {
    console.log('nothing to do.')
    await browser.close()
    return
  }

  queue.start()
  await queue.onIdle()
  console.log('finished.')
  await browser.close()
}

async function main() {
  try {
    while (true) {
      await runUpdate()
      await sleep(SLEEP_SECONDS * 1000)
    }
  } catch (err) {
    console.error('fatal error:', err)
    process.exit(1)
  }
}

main()
