/**
 * 鲸鱼梦境 (whale-dream) — 宿主半边。
 *
 * 皮肤本身是**纯资产目录**（skin.json + CSS + 插画），不执行任何代码，
 * 由皮肤中心（@linxin666/dsh-client-ui-skin-center）发现并渲染。皮肤中心
 * 发现皮肤的两个来源是：
 *
 *   1. 用户目录  $DSH_HOME/skins/<id>/   （社区/本地放置的皮肤）
 *   2. 内置目录  <skin-center 包>/skins/<id>/
 *
 * 皮肤是 npm 包的一部分时，用第 2 条；但一个「独立插件」的第 2 条走不通
 * —— 皮肤中心不会去扫别人的 node_modules。所以这个插件走第 1 条：
 * 挂载时把随包发布的 skin-assets/ 物化到 $DSH_HOME/skins/whale-dream/，
 * 皮肤中心下次扫描（它有指纹缓存，新增目录会触发重扫）就能看到它。
 *
 * 约定与刻意的取舍：
 *  - **不注册任何路由**：皮肤中心自己通过 /skins/<id>/asset/... 伺服皮肤
 *    目录里的文件，插件再开一套只会是重复的第二个真相。
 *  - **不做 hooks.mjs**：皮肤中心只对「内置」或「官方市场且字节校验通过」
 *    的皮肤放行 hooks；用户目录里的 hooks 会被拒绝。所以本皮肤的视觉效果
 *    全部由 skin.css + patches.css + backgroundMedia 声明式实现，零可执行代码。
 *  - **幂等部署**：逐文件比对字节，一致就跳过；已存在但内容不同的同 id 皮肤
 *    不会被覆盖 —— 那通常是你自己在改它。
 *
 * @module dsh-skin-whale-dream
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本插件发布的皮肤 id；必须与 skin.json 的 id、目标目录名三者一致。 */
const SKIN_ID = 'whale-dream'

/** 随包发布的皮肤资产目录。 */
const ASSETS_DIR = fileURLToPath(new URL('../skin-assets/', import.meta.url))

export const name = 'dsh-skin-whale-dream'

/**
 * 解析 DSH home，与 dsh 启动器和皮肤中心保持同一优先级：
 * 注入的 home → $DSH_HOME → homedir()/.dsh（未注入 home 时先是 <home>/.dsh）。
 */
function resolveHarnessHome() {
  const injected = process.env.DSH_HOME
  if (typeof injected === 'string' && injected.trim() !== '') return injected
  return join(homedir(), '.dsh')
}

/**
 * 皮肤中心的用户皮肤目录。它自己支持两个覆盖变量，这里必须跟随，
 * 否则插件会把皮肤放到一个皮肤中心根本不看的位置。
 */
function resolveUserSkinsDir() {
  const skinsHome = process.env.DSH_SKINS_HOME
  if (typeof skinsHome === 'string' && skinsHome.trim() !== '') return skinsHome
  const skinsDir = process.env.DSH_SKINS_DIR
  if (typeof skinsDir === 'string' && skinsDir.trim() !== '') return skinsDir
  return join(resolveHarnessHome(), 'skins')
}

/** 递归列出相对文件路径，正斜杠分隔，排序稳定。 */
function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) out.push(relative(root, abs).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/**
 * 列出两边内容不一致的文件：源里有而目标缺失、或两边字节不同。
 * 只影响部署决策（有哪些文件需要写），不参与写入本身。
 */
function differingFiles(sourceRoot, targetRoot, files) {
  const diff = []
  for (const rel of files) {
    const target = join(targetRoot, rel)
    if (!existsSync(target)) {
      diff.push(rel)
      continue
    }
    try {
      const a = readFileSync(join(sourceRoot, rel))
      const b = readFileSync(target)
      if (a.length !== b.length || !a.equals(b)) diff.push(rel)
    } catch {
      diff.push(rel)
    }
  }
  return diff
}

/** 目标目录里存在、但源里没有的文件（用户自己加的东西，绝不动）。 */
function filesOnlyInTarget(sourceRoot, targetRoot, files) {
  if (!existsSync(targetRoot)) return []
  const known = new Set(files)
  const extra = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) {
        const rel = relative(targetRoot, abs).split(sep).join('/')
        if (!known.has(rel)) extra.push(rel)
      }
    }
  }
  walk(targetRoot)
  return extra.sort()
}

/**
 * 把皮肤资产物化进用户皮肤目录。
 *
 * 覆盖策略分两种情况，因为「目标已存在」有两种完全不同的原因：
 *  - 文件集与源完全一致（只是内容不同）→ 判定为**用户自己的改动**，
 *    保留现场、只给出提示，除非显式设置 DSH_SKIN_WHALE_DREAM_FORCE=1。
 *    否则每次启动都会把用户的修改冲掉。
 *  - 出现了源里没有的文件 → 判定为**旧版本残留**，按文件逐个更新补齐，
 *    但只覆盖两边都有的交集，用户额外新增的文件一律保留。
 *
 * @returns 结果描述，交给日志；永不抛错（插件不应因部署失败拖垮 profile 启动）。
 */
function materializeSkin() {
  const sourceRoot = ASSETS_DIR
  if (!existsSync(join(sourceRoot, 'skin.json'))) {
    return { ok: false, reason: `bundled skin-assets/ is missing skin.json at ${sourceRoot}` }
  }

  const targetRoot = join(resolveUserSkinsDir(), SKIN_ID)
  const files = listFiles(sourceRoot)
  const targetExists = existsSync(join(targetRoot, 'skin.json'))
  const force = process.env.DSH_SKIN_WHALE_DREAM_FORCE === '1'

  if (targetExists) {
    const differing = differingFiles(sourceRoot, targetRoot, files)
    if (differing.length === 0) {
      return { ok: true, changed: false, targetRoot, files: files.length }
    }
    const extra = filesOnlyInTarget(sourceRoot, targetRoot, files)
    if (extra.length === 0 && !force) {
      return {
        ok: true,
        changed: false,
        targetRoot,
        files: files.length,
        skipped: `${differing.length} file(s) differ from the bundled copy (${differing.slice(0, 3).join(', ')}${differing.length > 3 ? ', …' : ''}); keeping your edits — set DSH_SKIN_WHALE_DREAM_FORCE=1 to overwrite`,
      }
    }
  }

  let written = 0
  for (const rel of files) {
    const target = join(targetRoot, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(join(sourceRoot, rel)))
    written += 1
  }
  return { ok: true, changed: written > 0, targetRoot, files: files.length, written }
}

/**
 * 插件入口。挂载时部署一次皮肤资产，然后就不再持有任何东西。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const report = materializeSkin()
  const log = ctx?.logger?.info?.bind(ctx.logger) ?? ((...args) => console.log('[whale-dream]', ...args))
  const warn = ctx?.logger?.warn?.bind(ctx.logger) ?? ((...args) => console.warn('[whale-dream]', ...args))

  if (!report.ok) {
    warn(`skin not deployed: ${report.reason}`)
    return
  }
  if (report.skipped !== undefined) {
    warn(`left "${SKIN_ID}" untouched at ${report.targetRoot}: ${report.skipped}`)
    return
  }
  if (report.changed) {
    log(`deployed skin "${SKIN_ID}" (${report.written}/${report.files} files) -> ${report.targetRoot}`)
  } else {
    log(`skin "${SKIN_ID}" already current at ${report.targetRoot}`)
  }
}
