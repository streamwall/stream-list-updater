#!/usr/bin/env node
const {GoogleSpreadsheet} = require('google-spreadsheet')
const fetch = require('node-fetch')

const FROM_SHEETS = process.env.FROM_SHEETS.split('|').map(s => s.split(','))
const TO_SHEET_ID = process.env.TO_SHEET_ID
const TO_TAB_NAME = process.env.TO_TAB_NAME
const ANNOUNCE_WEBHOOK_URL = process.env.ANNOUNCE_WEBHOOK_URL
const ANNOUNCE_DETAILS_WEBHOOK_URL = process.env.ANNOUNCE_DETAILS_WEBHOOK_URL
const SLEEP_SECONDS = process.env.SLEEP_SECONDS
const CREDS = require('./creds.json')

const {doWithRetry, sleep, getLinkInfo} = require('./utils')

async function announce(row) {
  await fetch(ANNOUNCE_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: 'New Stream',
      content: `**${row.Source}** — ${row.City}, ${row.State} (${row.Type}, ${row.View})${row.Notes ? ' ' + row.Notes : ''} <${row.Link}>`,
    }),
  })
}

async function announceDetails(row, linkInfo) {
  if (ANNOUNCE_DETAILS_WEBHOOK_URL) {
    const {streamType, embed} = linkInfo

    const msgParts = []
    msgParts.push(`**${row.Source}** — ${row.City}, ${row.State} (${row.Type}, ${row.View})${row.Notes ? ' ' + row.Notes : ''}`)
    msgParts.push(`:link: <${row.Link}>`)
    if (embed) {
      msgParts.push(`:gear: <${embed}>`)
    }

    await fetch(ANNOUNCE_DETAILS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'New Stream',
        content: msgParts.join('\n'),
      }),
    })
  }
}

async function runPublish() {
  const toDoc = new GoogleSpreadsheet(TO_SHEET_ID)
  await toDoc.useServiceAccountAuth(CREDS)
  await toDoc.loadInfo()
  const toSheet = Object.values(toDoc.sheetsById).find(s => s.title === TO_TAB_NAME)
  await toSheet.loadHeaderRow()

  const toRows = await doWithRetry(() => toSheet.getRows())
  const publishedURLs = new Set(toRows.map(r => r.Link))

  for (const docInfo of FROM_SHEETS) {
    const [sheetID, ...tabNames] = docInfo

    const doc = new GoogleSpreadsheet(sheetID)
    await doc.useServiceAccountAuth(CREDS)
    await doc.loadInfo()

    const sheets = Object.values(doc.sheetsById).filter(s => tabNames.includes(s.title))
    for (const sheet of sheets) {
      const rows = await doWithRetry(() => sheet.getRows())
      for (const row of rows) {
        if (!row.Link || row.Published !== '') {
          continue
        }

        if (row.hasOwnProperty('Vetted') && row.Vetted !== 'x') {
          continue
        }

        const linkInfo = await getLinkInfo(row.Link)
        if (linkInfo.normalizedURL) {
          row.Link = linkInfo.normalizedURL
        }

        if (publishedURLs.has(row.Link)) {
          row.Published = 'dupe'
          await doWithRetry(() => row.save())
          console.log(`skipped dupe ${row.Link}`)
          continue
        }

        await doWithRetry(() => toSheet.addRow(row))
        row.Published = 'x'
        await doWithRetry(() => row.save())
        publishedURLs.add(row.Link)

        await announce(row)
        await announceDetails(row, linkInfo)

        console.log(`published ${row.Link}`)
      }
    }
  }
}

async function main() {
  while (true) {
    await runPublish()
    await sleep(SLEEP_SECONDS * 1000)
  }
}

main()
