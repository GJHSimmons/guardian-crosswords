// Real-app verification for #21: drives installed Chrome against the local
// Vite dev server (proxying to the Flask backend) with Cryptic 29800.
import puppeteer from 'puppeteer-core'
import fs from 'fs'

const BASE = 'http://localhost:5221'
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: '1366x768', width: 1366, height: 768, deviceScaleFactor: 1 },
]
const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])

const metrics = {}
for (const vp of VIEWPORTS) {
  const page = await browser.newPage()
  await page.setViewport(vp)
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.select('.picker select', 'cryptic')
  await page.type('.picker input', '29800')
  await page.click('.picker button')
  await page.waitForSelector('.grid-container svg')
  await sleep(800)

  const m = () => page.evaluate(() => {
    const r = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y + scrollY), Math.round(b.width), Math.round(b.height)] }
    const btn = document.querySelector('.btn-copy-link')
    const vis = [...btn.children].filter(s => getComputedStyle(s).visibility === 'visible').map(s => s.textContent)
    const fb = document.querySelector('.feedback')
    return {
      grid: r('.grid-container'), wrapper: r('.crossword-wrapper'), controls: r('.controls'),
      activeClue: r('.active-clue'), button: r('.btn-copy-link'), buttonLabel: vis.join(''),
      buttonBg: getComputedStyle(btn).backgroundColor,
      feedback: fb && { text: fb.innerText, kind: fb.className, rect: r('.feedback') },
    }
  })
  const shot = async (label, full = false) => {
    const file = `${OUT}${label}-cryptic-29800-${vp.name}.png`
    await page.screenshot({ path: file, fullPage: full })
    return file
  }
  const rec = {}
  rec.baseline = await m(); await shot('0-baseline')

  // Copy link, success path (real clipboard, permission granted)
  await page.click('.btn-copy-link')
  await sleep(150)
  rec.copied = await m()
  rec.clipboard = await page.evaluate(() => navigator.clipboard.readText())
  rec.url = page.url()
  await shot('1-copy-link-copied')
  await sleep(2100)
  rec.copiedReverted = await m()

  // Check word with one wrong letter: select 1 Across, type TOASTEX
  const firstCell = await page.$('.grid-container svg g.clue-cell')
  await firstCell.click()
  await sleep(100)
  await page.keyboard.type('TOASTEX', { delay: 20 })
  await sleep(200)
  // re-select 1 Across so Check applies to it
  await firstCell.click(); await sleep(100)
  const selected = await page.$eval('.active-clue', e => e.innerText)
  if (!selected.includes('1 Across')) { await firstCell.click(); await sleep(100) }
  rec.selectedClue = await page.$eval('.active-clue', e => e.innerText)
  await page.click('.controls .control-group:nth-child(1) .btn-check')
  await sleep(150)
  rec.checkWrong = await m(); await shot('2-check-word-wrong')
  await sleep(3200)
  rec.checkWrongCleared = await m()

  // Check word, all correct: type the answer, check again
  await firstCell.click(); await sleep(100)
  const sel2 = await page.$eval('.active-clue', e => e.innerText)
  if (!sel2.includes('1 Across')) { await firstCell.click(); await sleep(100) }
  await page.keyboard.type('TOASTER', { delay: 20 })
  await firstCell.click(); await sleep(100)
  const sel3 = await page.$eval('.active-clue', e => e.innerText)
  if (!sel3.includes('1 Across')) { await firstCell.click(); await sleep(100) }
  await page.click('.controls .control-group:nth-child(1) .btn-check')
  await sleep(150)
  rec.checkCorrect = await m(); await shot('3-check-word-no-mistakes')
  await sleep(3200)

  // Reveal all, then Undo Reveal ("Reveal undone")
  await page.click('.controls .control-group:nth-child(2) .btn-reveal')
  await sleep(300)
  rec.revealAll = await m()
  await page.click('.btn-undo')
  await sleep(150)
  rec.undoReveal = await m(); await shot('4-undo-reveal')
  await sleep(3200)

  // Copy link, failure path: clipboard rejects -> URL fallback in the controls slot
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } })
  })
  await page.click('.btn-copy-link')
  await sleep(150)
  rec.copyFailed = await m(); await shot('5-copy-link-clipboard-failed')
  await sleep(3200)
  rec.copyFailedCleared = await m()

  metrics[vp.name] = rec
  await page.close()
}
fs.writeFileSync(`${OUT}metrics.json`, JSON.stringify(metrics, null, 2))
await browser.close()
console.log(JSON.stringify(metrics, null, 1))
