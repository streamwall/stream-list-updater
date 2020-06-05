#!/usr/bin/env node
const {GoogleSpreadsheet} = require('google-spreadsheet')
const fetch = require('node-fetch')

const FROM_SHEET_ID = process.env.FROM_SHEET_ID
const FROM_TAB_NAME = process.env.FROM_TAB_NAME
const TO_SHEET_ID = process.env.TO_SHEET_ID
const TO_TAB_NAME = process.env.TO_TAB_NAME
const ANNOUNCE_WEBHOOK_URL = process.env.ANNOUNCE_WEBHOOK_URL
const SLEEP_SECONDS = process.env.SLEEP_SECONDS
const CREDS = require('./creds.json')

const {doWithRetry, sleep} = require('./utils')

async function runPublish() {
  const fromDoc = new GoogleSpreadsheet(FROM_SHEET_ID)
  await fromDoc.useServiceAccountAuth(CREDS)
  await fromDoc.loadInfo()
  const fromSheet = Object.values(fromDoc.sheetsById).find(s => s.title === FROM_TAB_NAME)
  await fromSheet.loadHeaderRow()

  const toDoc = new GoogleSpreadsheet(TO_SHEET_ID)
  await toDoc.useServiceAccountAuth(CREDS)
  await toDoc.loadInfo()
  const toSheet = Object.values(toDoc.sheetsById).find(s => s.title === TO_TAB_NAME)
  await toSheet.loadHeaderRow()

  const rows = await doWithRetry(() => fromSheet.getRows())
  for (const row of rows) {
    if (!row.Link || row.x === 'x') {
      continue
    }

    await doWithRetry(() => toSheet.addRow(row))
    row.x = 'x'
    await doWithRetry(() => row.save())

    const resp = await fetch(ANNOUNCE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'Stream Published',
        content: `:link: **${row.Source}** — ${row.City}, ${row.State} (${row.Type}, ${row.View}) <${row.Link}>`,
      }),
    })

    console.log(`Published ${row.Link}`)
  }
}

async function main() {
  while (true) {
    await runPublish()
    await sleep(SLEEP_SECONDS * 1000)
  }
}

main()
