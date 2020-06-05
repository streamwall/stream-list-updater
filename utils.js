const {promisify} = require('util')

module.exports.sleep = promisify(setTimeout)

module.exports.doWithRetry = async function doWithRetry(func) {
  let result
  let tries = 0
  while (tries < 2) {
    try {
      return await func()
    } catch (err) {
      if (err.response && err.response.status === 429) {
        console.log('ratelimited. waiting 10s...')
        await sleep(10000)
        tries++
        continue
      } else {
        throw err
      }
    }
  }
  return await func()
}
