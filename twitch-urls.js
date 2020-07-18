#!/usr/bin/env node
const {GoogleSpreadsheet} = require('google-spreadsheet')
const {ChatClient} = require('dank-twitch-irc')
const moment = require('moment-timezone')
const Discord = require('discord.js')

const SHEET_ID = process.env.SHEET_ID
const TAB_NAME = process.env.TAB_NAME
const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const DISCORD_CHANNELS = process.env.DISCORD_CHANNELS && process.env.DISCORD_CHANNELS.split(',')
const SHEET_CREDS = require('./gs-creds.json')

const {doWithRetry, sleep} = require('./utils')

const ignoreDisplayNames = new Set([
  'StreamElements',
  'wokenet',
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
  await doc.useServiceAccountAuth(SHEET_CREDS)
  await doc.loadInfo()
  const sheet = Object.values(doc.sheetsById).find(s => s.title === TAB_NAME)
  await sheet.loadHeaderRow()

  const twitchClient = new ChatClient()

  twitchClient.on('ready', () => console.log('connected'))
  twitchClient.on('close', err => {
    if (err != null) {
      console.error('disconnected due to error', error)
    }
  })

  function handleMessage(messageText, displayName) {
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
        const row = doWithRetry(() => sheet.addRow({
          URL: match.toString(),
          'Timestamp (CST)': moment().tz("America/Chicago").format('M/D/YY HH:mm:ss'),
          Message: messageText,
          'Display Name': displayName,
        }))
      }
    }
  }

  twitchClient.on('PRIVMSG', async msg => {
    const {messageText, displayName} = msg
    handleMessage(messageText, displayname)
  })

  twitchClient.connect()
  twitchClient.join('woke')

  if (DISCORD_TOKEN) {
    const discordClient = new Discord.Client()
    discordClient.login(DISCORD_TOKEN)
    discordClient.on("message", (message) => {
      if (!DISCORD_CHANNELS.includes(message.channel.name)) {
        return
      }
      const messageText = message.content
      const displayName = message.author.username
      handleMessage(messageText, displayName)
    });
  }
}

main()
