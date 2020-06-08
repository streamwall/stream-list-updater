#!/usr/bin/env node
const http = require('http')
const OAuth = require('oauth').OAuth
const url = require('url')

const callbackURL = 'http://localhost:3000/callback'

if (process.argv.length !== 4) {
  console.log('Usage: node setupTwitter.js CONSUMER_KEY CONSUMER_SECRET')
  process.exit(1)
}
const CONSUMER_KEY = process.argv[2]
const CONSUMER_SECRET = process.argv[3]

const oa = new OAuth(
  'https://api.twitter.com/oauth/request_token',
  'https://api.twitter.com/oauth/access_token',
  CONSUMER_KEY,
  CONSUMER_SECRET,
  '1.0',
  callbackURL,
  'HMAC-SHA1'
)

// based on https://github.com/ciaranj/node-oauth/blob/a7f8a1e21c362eb4ed2039431fb9ac2ae749f26a/examples/twitter-example.js
http.createServer(function(req, res) {
  oa.getOAuthRequestToken(function(error, oAuthToken, oAuthTokenSecret, results) {
    console.log(error)
    const urlObj = url.parse(req.url, true)
    const authURL = 'https://twitter.com/oauth/authenticate?oauth_token=' + oAuthToken
    const handlers = {
      '/': function(req, res) {
        const body = `<a href="${authURL}">Authorize with Twitter</a>`
        res.writeHead(200, {
          'Content-Length': Buffer.byteLength(body, 'utf8'),
          'Content-Type': 'text/html',
        })
        res.end(body)
      },

      '/callback': function(req, res) {
        const getOAuthRequestTokenCallback = function(error, oAuthAccessToken, oAuthAccessTokenSecret, results) {
          if (error) {
            console.error(error)
            res.writeHead(500)
            return res.end('error')
          }

          oa.get('https://api.twitter.com/1.1/account/verify_credentials.json', oAuthAccessToken, oAuthAccessTokenSecret, function(error, twitterResponse, result) {
            if (error) {
              console.error(error)
              res.writeHead(500)
              return res.end('error')
            }

            const config = {
              consumer_key: CONSUMER_KEY,
              consumer_secret: CONSUMER_SECRET,
              access_token_key: oAuthAccessToken,
              access_token_secret: oAuthAccessTokenSecret,
            }

            const configText = JSON.stringify(config, null, 2)
            console.log(configText)

            const body = `<meta charset="utf-8"><p>Success! Output config:</p><pre>${configText}</pre>`
            res.writeHead(200, {
              'Content-Length': Buffer.byteLength(body, 'utf8'),
              'Content-Type': 'text/html',
            })
            res.end(body)
            process.exit(0)
          })
        }

        oa.getOAuthAccessToken(urlObj.query.oauth_token, oAuthTokenSecret, urlObj.query.oauth_verifier, getOAuthRequestTokenCallback)
      }
    }
    const handler = handlers[urlObj.pathname]
    if (handler) {
      handler(req, res)
    } else {
      res.writeHead(404)
      res.end('invalid url')
    }
  })
}).listen(3000)

// Print to stderr
console.error('Running on http://localhost:3000')
