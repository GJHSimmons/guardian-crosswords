// usage: node cdp-shot.mjs <prefix>
// Captures the real app (Vite dev server -> real Flask backend) at exact
// emulated viewports via the DevTools protocol, and prints layout metrics.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const prefix = process.argv[2] || 'shot'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const puzzles = [
  ['cryptic-29800', 'b7dd3e04-31e3-46e9-9d9a-79cbc2777c9b'],
  ['quiptic-1300', '4880704e-260b-4ca8-b352-a409bde62ae3'],
  ['quickcryptic-50', '5b08e4c4-ae8d-4aa0-8264-0cb877204b53'],
]
const sizes = [
  [320, 568, true], [375, 812, true], [768, 1024, true],
  [1366, 768, false], [1920, 1080, false],
]

const prof = mkdtempSync(join(tmpdir(), 'cdp-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

let tab
for (let i = 0; i < 50 && !tab; i++) {
  try { tab = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page') } catch { await sleep(200) }
}
const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

const MEASURE = `(() => {
  const b = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const g = b('.grid-container'); const svg = document.querySelector('.grid-container svg')
  const cols = svg ? svg.viewBox.baseVal.width / 10 : 0
  const sc = document.querySelector('.grid-scroll')
  return { iw: innerWidth, ih: innerHeight, docW: document.documentElement.scrollWidth,
    grid: g, clues: b('.clues-panel'), cell: g && cols ? +(b('.grid-container svg').w / cols).toFixed(1) : null,
    gridScrolls: sc ? sc.scrollWidth > sc.clientWidth : null }
})()`

await send('Page.enable'); await send('Runtime.enable')
const results = []
for (const [name, gid] of puzzles) {
  for (const [w, h, mobile] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
    await send('Page.navigate', { url: `http://localhost:5173/game/${gid}` })
    for (let i = 0; i < 60; i++) { await sleep(250); if (await evaluate(`!!document.querySelector('.grid-container svg rect')`)) break }
    await sleep(600)
    const m = await evaluate(MEASURE)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${prefix}-${name}-${w}.png`
    writeFileSync(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
    results.push({ file, ...m })
    console.log(file, JSON.stringify(m))
  }
}
writeFileSync(join(OUT, `${prefix}-metrics.json`), JSON.stringify(results, null, 2))
ws.close(); chrome.kill()
process.exit(0)
