/**
 * 重新渲染皮肤预览图：把 skin-assets/assets/*.svg 用 Edge 无头模式截成
 * preview/dark.png 与 preview/light.png。
 *
 * 用法（没有全局 node 时可用 DSH 自带的运行时）：
 *   node tools/render-previews.mjs
 *   node tools/render-previews.mjs --edge "C:\path\to\msedge.exe"
 *
 * 改完插画后跑一次即可，不需要任何 npm 依赖。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skinRoot = resolve(here, '..', 'skin-assets')
const previewDir = join(skinRoot, 'preview')
const shotPage = join(here, 'preview-shot.html')

const EDGE_CANDIDATES = [
  process.env.MSEDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
].filter((p) => typeof p === 'string' && p !== '')

const argEdge = process.argv.indexOf('--edge')
const edge = argEdge !== -1 ? process.argv[argEdge + 1] : EDGE_CANDIDATES.find((p) => existsSync(p))

if (edge === undefined || !existsSync(edge)) {
  console.error('找不到 Edge。用 --edge <路径> 指定，或设置 MSEDGE_PATH。')
  process.exit(2)
}

mkdirSync(previewDir, { recursive: true })

const shots = [
  ['dark', join(skinRoot, 'assets', 'whale-dream-dark.svg')],
  ['light', join(skinRoot, 'assets', 'whale-dream-light.svg')],
]

let failed = 0
for (const [theme, svg] of shots) {
  if (!existsSync(svg)) {
    console.error(`缺少插画：${svg}`)
    failed += 1
    continue
  }
  const out = join(previewDir, `${theme}.png`)
  const url = `${pathToFileURL(shotPage).href}?src=${encodeURIComponent(pathToFileURL(svg).href)}`
  const result = spawnSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${join(resolve(here, '..'), '.edge-preview-profile')}`,
    '--window-size=1200,750',
    `--screenshot=${out}`,
    '--virtual-time-budget=6000',
    url,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.status !== 0 || !existsSync(out)) {
    console.error(`渲染失败：${theme} (status=${result.status})`)
    failed += 1
  } else {
    console.log(`ok  ${theme} -> ${out}`)
  }
}

process.exit(failed === 0 ? 0 : 1)
