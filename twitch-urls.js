const {promisify} = require('util')
const {GoogleSpreadsheet} = require('google-spreadsheet')
const {ChatClient} = require('dank-twitch-irc')
const moment = require('moment-timezone')

const SHEET_ID = process.env.SHEET_ID
const CREDS = require('./creds.json')

const sleep = promisify(setTimeout)

const ignoreDisplayNames = new Set([
  'StreamElements',
])

const interestingPrefixes = [
  'www.youtube.com',
  'youtu.be',
  'www.facebook.com',
  'www.instagram.com',
  'www.periscope.tv',
  'www.pscp.tv',
  'www.twitch.tv',
  'twitter.com/i/broadcasts',
]

const urlRe = /https?:\/\/[^ ]+/g

async function main() {
  const doc = new GoogleSpreadsheet(SHEET_ID)
  await doc.useServiceAccountAuth(CREDS)
  await doc.loadInfo()
  const sheet = doc.sheetsByIndex[0]
  await sheet.loadHeaderRow()

  async function addRow(data) {
    let tries = 0

    while (tries < 3) {
      try {
        const row = await sheet.addRow(data)
      } catch (err) {
        console.log('ratelimited. waiting 5s...')
        await sleep(5000)
        tries++
        continue
      }

      return
    }
  }

  const client = new ChatClient()

  client.on('ready', () => console.log('connected'))
  client.on('close', err => {
    if (err != null) {
      console.error('disconnected due to error', error)
    }
  })

  client.on('PRIVMSG', async msg => {
    const {messageText, displayName} = msg

    if (ignoreDisplayNames.has(displayName)) {
      return
    }

    for (const match of messageText.matchAll(urlRe)) {
      let url
      try {
        url = new URL(match)
      } catch (err) {
        continue
      }

      const urlStart = url.host + url.pathname
      if (interestingPrefixes.some(p => urlStart.startsWith(p))) {
        console.log(`[${displayName}] ${messageText}`)
        const row = addRow({
          URL: match.toString(),
          Timestamp: moment().tz("America/Chicago").format('M/D/YY HH:mm:ss'),
          Message: messageText,
          'Display Name': displayName,
        })
      }
    }
  })

  client.connect()
  client.join('woke')
}

main()
