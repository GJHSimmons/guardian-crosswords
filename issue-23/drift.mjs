// usage: node drift.mjs <label> [baseUrl]
// Measures, in the real app, how far the library's focused-cell box (its
// absolutely positioned <input>) and our PlayerOverlay tints sit from the SVG
// cells they mark, in the top, middle and bottom rows. Two isolated browser
// contexts = two players (playerId lives in localStorage).
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const label = process.argv[2] || 'run'
const BASE = process.argv[3] || 'http://localhost:5183'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9344
const puzzles = [
  ['cryptic-29800', '58ddfde8-5a35-4d95-8b41-913052f3f290'],
  ['quickcryptic-50', 'ad64b670-c29b-4b79-83f1-32ddfa5a52fc'],
]
const sizes = [
  [320, 568, true], [375, 812, true], [768, 1024, true],
  [1366, 768, false], [1920, 1080, false],
]
const sleep = ms => new Promise(r => setTimeout(r, ms))

const prof = mkdtempSync(join(tmpdir(), 'cdp-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let ver
for (let i = 0; i < 50 && !ver; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(200) }
}
const ws = new WebSocket(ver.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId && { sessionId }) })) })

async function newPage() {
  const { result: { browserContextId } } = await send('Target.createBrowserContext')
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
  const s = (m, p) => send(m, p, sessionId)
  await s('Page.enable'); await s('Runtime.enable')
  await s('Emulation.setFocusEmulationEnabled', { enabled: true })
  const evaluate = async expr => {
    const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
    return r.result?.result?.value
  }
  return { s, evaluate }
}

async function load(p, url, w, h, mobile) {
  await p.s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await p.s('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  await p.s('Page.navigate', { url })
  for (let i = 0; i < 60; i++) { await sleep(250); if (await p.evaluate(`!!document.querySelector('.grid-container svg g rect')`)) break }
  await sleep(700)
}

// Shared page-side helpers: the used cells, the target cells (leftmost and
// rightmost used cell of the top, middle and bottom rows), and a cell's box.
const HELPERS = `
  window.__g = () => {
    const svg = document.querySelector('.crossword.grid svg')
    const vb = svg.viewBox.baseVal, rows = vb.height / 10, cols = vb.width / 10
    const byRC = {}
    for (const r of svg.querySelectorAll('g rect')) byRC[Math.floor(+r.getAttribute('y') / 10) + ',' + Math.floor(+r.getAttribute('x') / 10)] = r
    const targets = []
    for (const row of [0, Math.floor((rows - 1) / 2), rows - 1]) {
      const used = [...Array(cols).keys()].filter(c => byRC[row + ',' + c])
      targets.push([row, used[0]]); if (used.at(-1) !== used[0]) targets.push([row, used.at(-1)])
    }
    // A cell's full pitch box in px, from the SVG's own rendered box.
    const pitch = (row, col) => { const b = svg.getBoundingClientRect(); const u = b.height / (rows * 10), v = b.width / (cols * 10)
      return { top: b.top + row * 10 * u, left: b.left + col * 10 * v, h: 10 * u, w: 10 * v } }
    return { svg, rows, cols, byRC, targets, pitch }
  }
  window.__center = (row, col) => { const { byRC } = __g(); const r = byRC[row + ',' + col]
    r.scrollIntoView({ block: 'center', inline: 'center' }); const b = r.getBoundingClientRect()
    return [b.left + b.width / 2, b.top + b.height / 2] }
  true`

async function click(p, [x, y], mobile) {
  if (mobile) {
    await p.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await p.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    for (const type of ['mousePressed', 'mouseReleased']) await p.s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await sleep(150)
}

const r2 = n => +n.toFixed(2)
const A = await newPage(), B = await newPage()
const results = []
for (const [name, gid] of puzzles) {
  const url = `${BASE}/game/${gid}`
  // Player B fills a letter into every target cell so A sees B's tints there.
  await load(B, url, 1366, 900, false); await B.evaluate(HELPERS)
  const targets = await B.evaluate(`__g().targets`)
  for (const [row, col] of targets) {
    await click(B, await B.evaluate(`__center(${row}, ${col})`), false)
    await B.s('Input.insertText', { text: 'X' }); await sleep(150)
  }
  for (const [w, h, mobile] of sizes) {
    await load(A, url, w, h, mobile); await A.evaluate(HELPERS)
    const sizesPx = await A.evaluate(`(() => { const hh = s => r2(document.querySelector(s).getBoundingClientRect().height); function r2(n){return +n.toFixed(2)}
      const svg = document.querySelector('.crossword.grid svg'); const sc = document.querySelector('.grid-scroll')
      return { iw: innerWidth, docW: document.documentElement.scrollWidth, svgW: r2(svg.getBoundingClientRect().width), svgH: hh('.crossword.grid svg'),
        innerDivH: r2(svg.parentElement.getBoundingClientRect().height), wrapperH: hh('.crossword.grid'), gridContainerH: hh('.grid-container'),
        scrolls: sc.scrollWidth > sc.clientWidth } })()`)
    const rows = []
    for (const [row, col] of targets) {
      await click(A, await A.evaluate(`__center(${row}, ${col})`), mobile)
      const m = await A.evaluate(`(() => {
        const { pitch } = __g(); const c = pitch(${row}, ${col})
        const inp = document.querySelector('input[aria-label="crossword-input"]'); const ib = inp.getBoundingClientRect()
        // The library insets its box 2px on every side, so compare centres and size.
        const focus = { dy: ib.top + ib.height / 2 - (c.top + c.h / 2), dx: ib.left + ib.width / 2 - (c.left + c.w / 2), dh: ib.height - (c.h - 4), dw: ib.width - (c.w - 4),
          active: document.activeElement === inp, focusVisible: inp.matches(':focus-visible'), outline: getComputedStyle(inp).outlineStyle }
        // The other player's tint over this cell: its box should be exactly the pitch box.
        let tint = null
        const ov = document.querySelector('.grid-container > div[style*="inset"]') || [...document.querySelectorAll('.grid-container > div')].find(d => d.style.position === 'absolute')
        if (ov) for (const d of ov.children) { const b = d.getBoundingClientRect()
          if (Math.abs(b.left + b.width / 2 - (c.left + c.w / 2)) < c.w / 2 && Math.abs(b.top + b.height / 2 - (c.top + c.h / 2)) < c.h / 2)
            tint = { dTop: b.top - c.top, dBottom: b.bottom - (c.top + c.h), dLeft: b.left - c.left, dRight: b.right - (c.left + c.w) } }
        return { focus, tint }
      })()`)
      const f = m.focus, t = m.tint
      rows.push({ row, col, cellPx: r2((sizesPx.svgW) / (await A.evaluate('__g().cols'))),
        focus: { dy: r2(f.dy), dx: r2(f.dx), dh: r2(f.dh), dw: r2(f.dw), active: f.active, focusVisible: f.focusVisible, outline: f.outline },
        tint: t && Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)])) })
    }
    const worstFocus = Math.max(...rows.map(r => Math.max(Math.abs(r.focus.dy), Math.abs(r.focus.dx))))
    const worstTint = Math.max(...rows.map(r => r.tint ? Math.max(...Object.values(r.tint).map(Math.abs)) : NaN))
    const shot = await A.s('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, `${label}-${name}-${w}.png`), Buffer.from(shot.result.data, 'base64'))
    const res = { puzzle: name, w, h, ...sizesPx, worstFocus: r2(worstFocus), worstTint: r2(worstTint), rows }
    results.push(res)
    console.log(`${name} ${w}x${h} iw=${sizesPx.iw} docW=${sizesPx.docW} scrolls=${sizesPx.scrolls} svgH=${sizesPx.svgH} gcH=${sizesPx.gridContainerH} worstFocus=${res.worstFocus} worstTint=${res.worstTint}`)
    console.log('   ' + rows.map(r => `r${r.row}c${r.col}: focus dy=${r.focus.dy} dx=${r.focus.dx} fv=${r.focus.focusVisible}/${r.focus.outline} tint=${r.tint ? `${r.tint.dTop}/${r.tint.dBottom}/${r.tint.dLeft}/${r.tint.dRight}` : 'none'}`).join('\n   '))
  }
}
writeFileSync(join(OUT, `${label}-metrics.json`), JSON.stringify(results, null, 2))
ws.close(); chrome.kill()
process.exit(0)
