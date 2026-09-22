// usage: node cdp-shot.mjs <prefix>
// Captures the real app (Vite dev server -> real Flask backend) at exact
// emulated viewports via the DevTools protocol, and prints layout metrics.
// Adapted from issue-2/cdp-shot.mjs (PR #14). Differences: selects the
// longest clue before capturing (so the active-clue bar shows its worst-case
// height), and reports whether the whole grid and the active clue are inside
// the viewport without scrolling, and whether anything overflows sideways.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const prefix = process.argv[2] || 'shot'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const puzzles = [
  ['quiptic-1300', '121507ba-a515-40c1-bd02-f76975958f1f'],
  ['cryptic-29800', 'ab671419-f13b-463f-8e00-27f8cf5c9714'],
]
const sizes = [
  [375, 812, true], [768, 1024, true],
  [900, 700, false], [1366, 657, false],
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

// Click the longest clue so the active-clue bar holds real (worst-case) text.
const SELECT_LONGEST = `(() => {
  const clues = [...document.querySelectorAll('.clues-panel .clue')]
  const longest = clues.sort((a, b) => b.textContent.length - a.textContent.length)[0]
  longest?.click()
  return new Promise(r => setTimeout(() => { const y = scrollY; scrollTo(0, 0); r(y) }, 300))
})()`

const MEASURE = `(() => {
  const b = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) } }
  const g = b('.grid-container'); const svg = document.querySelector('.grid-container svg')
  const cols = svg ? svg.viewBox.baseVal.width / 10 : 0
  const sc = document.querySelector('.grid-scroll')
  const ac = b('.active-clue')
  return { iw: innerWidth, ih: innerHeight, docW: document.documentElement.scrollWidth,
    hOverflow: document.documentElement.scrollWidth > innerWidth,
    grid: g, controls: b('.controls'), activeClue: ac, clues: b('.clues-panel'),
    cell: g && cols ? +(b('.grid-container svg').w / cols).toFixed(1) : null,
    gridScrolls: sc ? sc.scrollWidth > sc.clientWidth : null,
    gridFullyVisible: !!g && g.y >= 0 && g.bottom <= innerHeight && g.right <= innerWidth,
    activeClueVisible: !!ac && ac.y >= 0 && ac.bottom <= innerHeight,
    activeClueText: document.querySelector('.active-clue')?.textContent.slice(0, 60) }
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
    const scrolledOnSelect = await evaluate(SELECT_LONGEST)
    await sleep(200)
    const m = { scrolledOnSelect, ...(await evaluate(MEASURE)) }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${prefix}-${name}-${w}x${h}.png`
    writeFileSync(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
    results.push({ file, ...m })
    console.log(file, `cell=${m.cell} grid=${JSON.stringify(m.grid)} gridVisible=${m.gridFullyVisible} clueVisible=${m.activeClueVisible} hOverflow=${m.hOverflow} scrolledOnSelect=${scrolledOnSelect}`)
  }
}
writeFileSync(join(OUT, `${prefix}-metrics.json`), JSON.stringify(results, null, 2))
ws.close(); chrome.kill()
process.exit(0)
