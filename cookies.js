const {CookieJar} = require('tough-cookie')
const {FileCookieStore} = require('tough-cookie-file-store')

const cookieJar = new CookieJar(new FileCookieStore('./cookies.json'))
module.exports.cookieJar = cookieJar

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.log(`usage: node ./cookie.js 'url' 'cookie'`)
    process.exit(1)
  }
  for (const cookie of args[1].split(';')) {
    cookieJar.setCookie(cookie, args[0])
  }
}
