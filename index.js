const {promisify} = require('util')
const keyBy = require('lodash/keyBy')
const cheerio = require('cheerio')
const {GoogleSpreadsheet} = require('google-spreadsheet')
const moment = require('moment-timezone')
const puppeteer = require('puppeteer')
const {default: PQueue} = require('p-queue')

const SHEETS = process.env.SHEETS.split('|').map(s => s.split(','))
const CREDS = require('./creds.json')

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
    await page.goto(url)
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
  const result = await findString('YouTube', `liveStreamability`)(page, url)
  if (result.html.includes('Our systems have detected unusual traffic from your computer network.')) {
    throw new CheckError({captcha: true}, 'YouTube CAPTCHA required')
  }
  const ytID = url.startsWith('https://youtu.be') ? url.split('youtu.be/')[1] : url.split('v=')[1]
  result.embed = `https://www.youtube.com/embed/${ytID}`
  return result
}

const checkFBLive = async function(page, url) {
  const result = await findString('Facebook', `"broadcast_status":"LIVE"`)(page, url)
  if (result.title === 'Security Check Required') {
    throw new CheckError({captcha: true}, 'Facebook CAPTCHA required')
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

async function updateRow(page, row) {
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
  await row.save()
}

async function main() {
  const queue = new PQueue({concurrency: 1, interval: 5000, intervalCap: 1, autoStart: false})

  const browser = await puppeteer.launch({headless: false})
  const page = await browser.newPage()

  function tryRow(row, tries=0) {
    return async function() {
      await sleep(tries * 5000)
      try {
        await updateRow(page, row)
      } catch (err) {
        if (err.response && err.response.status === 429) {
          queue.pause()
          console.log('ratelimited. waiting 5s...')
          await sleep(10000)
          queue.start()
	  return
        }

        console.warn('error updating row', row.Link, err, 'waiting for nav...')
	if (err.captcha) {
	  console.log('waiting for captcha...')
	  await page.waitForNavigation({timeout: 2 * 60 * 1000})
	}
        if (!err.retryable || tries > 3) {
          console.warn('giving up on row', row.Link)
          return
        }
        queue.add(tryRow(row, tries + 1))
        return
      }
      console.log('updated', row.Link)
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
      for (const row of rows) {
        if (!row.Link) {
          continue
        }
        queue.add(tryRow(row))
      }
    }
  }

  queue.start()
  await queue.onIdle()
  console.log('finished.')
}

main()
