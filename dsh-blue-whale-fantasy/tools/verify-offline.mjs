/**
 * 本地校验：把皮肤中心的 v2 契约规则在 Node 里重放一遍，
 * 并实际执行插件的 apply() 看它是否真的把皮肤部署到位。
 * 这不是替代 pnpm skin-center:check，而是没有该工具链时的等价检查。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** 本脚本位于 tools/，项目根是它上一级。 */
const projectRoot = resolve(here, '..')
const assets = join(projectRoot, 'skin-assets')
let failures = 0
const ok = (m) => console.log(`  ok   ${m}`)
const bad = (m) => { failures += 1; console.log(`  FAIL ${m}`) }
const check = (cond, m) => (cond ? ok(m) : bad(m))

console.log('== 1. manifest 结构 (skin-manifest-v2) ==')
const raw = JSON.parse(readFileSync(join(assets, 'skin.json'), 'utf8'))
const SKIN_ID = /^[a-z][a-z0-9-]{0,31}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const HEX = /^#[0-9a-fA-F]{6}$/
const REL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*:\/\/)[A-Za-z0-9._\-/]+$/

const TOP = new Set(['$schema','skinManifestVersion','id','name','nameEn','version','author','tagline','description','tags','accent','order','preview','license','licenseUrl','noticeUrl','sourceUrl','attribution','requires','contributes','facets'])
for (const k of Object.keys(raw)) check(TOP.has(k), `no unknown top-level field: ${k}`)
check(raw.skinManifestVersion === 2, 'skinManifestVersion === 2')
check(typeof raw.id === 'string' && SKIN_ID.test(raw.id), `id matches ${SKIN_ID}  (${raw.id})`)
for (const f of ['name','nameEn','author']) check(typeof raw[f] === 'string' && raw[f].length > 0, `${f} is a non-empty string`)
check(SEMVER.test(raw.version), `version is SemVer (${raw.version})`)
check(raw.accent === undefined || HEX.test(raw.accent), `accent is #rrggbb (${raw.accent})`)
check(raw.order === undefined || Number.isInteger(raw.order), `order is integer (${raw.order})`)

console.log('== 2. id 必须等于目录名 ==')
const targetDirName = raw.id
check(existsSync(assets), `asset dir exists`)
// 部署目标目录名必须 === id，否则皮肤中心会以 “manifest id must equal the directory name” 剔除
check(SKIN_ID.test(raw.id), `deploy target directory name will be "${targetDirName}" == id`)

console.log('== 3. contributes 引用的文件必须真实存在 ==')
const c = raw.contributes ?? {}
check(typeof c.stylesheet === 'string' && REL.test(c.stylesheet), `stylesheet is a safe rel path (${c.stylesheet})`)
check(existsSync(join(assets, c.stylesheet)), `stylesheet exists: ${c.stylesheet}`)
if (c.patches) {
  check(REL.test(c.patches), `patches is a safe rel path (${c.patches})`)
  check(existsSync(join(assets, c.patches)), `patches exists: ${c.patches}`)
}
for (const theme of ['light','dark']) {
  const layer = c.backgroundMedia?.[theme]
  if (!layer) { bad(`backgroundMedia.${theme} missing`); continue }
  check(layer.type === 'image' || layer.type === 'video', `backgroundMedia.${theme}.type valid (${layer.type})`)
  check(REL.test(layer.src), `backgroundMedia.${theme}.src safe rel path (${layer.src})`)
  check(existsSync(join(assets, layer.src)), `backgroundMedia.${theme}.src exists: ${layer.src}`)
}
if (raw.preview) {
  for (const theme of ['light','dark']) {
    const p = raw.preview[theme]
    check(typeof p === 'string' && REL.test(p), `preview.${theme} safe rel path (${p})`)
    check(existsSync(join(assets, p)), `preview.${theme} exists: ${p}`)
  }
}

console.log('== 4. CSS 白名单：不得出现远程/绝对/越界 URL ==')
for (const f of [c.stylesheet, c.patches].filter(Boolean)) {
  const css = readFileSync(join(assets, f), 'utf8')
  for (const m of css.matchAll(/url\(\s*([^)]*)\)/g)) {
    const u = m[1].trim().replace(/^["']|["']$/g, '')
    check(!/^https?:\/\//i.test(u) && !u.startsWith('//') && !u.startsWith('/') && !u.startsWith('../'),
      `${f}: url(${u}) is in-directory`)
  }
  check(!/@import/.test(css), `${f}: no @import`)
}

console.log('== 5. 实际执行宿主插件 apply() ==')
const deployTarget = join(tmpdir(), 'whale-dream-verify-skins')
rmSync(deployTarget, { recursive: true, force: true })
process.env.DSH_SKINS_HOME = deployTarget
const mod = await import(pathToFileURL(join(projectRoot, 'lib', 'index.js')).href)
check(typeof mod.apply === 'function', 'plugin exports apply()')
const logs = []
const fakeCtx = { logger: { info: (...a) => logs.push(['info', ...a]), warn: (...a) => logs.push(['warn', ...a]) } }
mod.apply(fakeCtx)

const deployedSkinDir = join(deployTarget, raw.id)
check(existsSync(join(deployedSkinDir, 'skin.json')), `deployed ${raw.id}/skin.json`)
const deployedManifest = JSON.parse(readFileSync(join(deployedSkinDir, 'skin.json'), 'utf8'))
check(deployedManifest.id === raw.id, 'deployed manifest id preserved')
check(dirname(deployedSkinDir) === deployTarget, 'skin dir sits directly under the user skins root')
for (const f of [c.stylesheet, c.patches, c.backgroundMedia.light.src, c.backgroundMedia.dark.src, raw.preview.light, raw.preview.dark].filter(Boolean)) {
  check(existsSync(join(deployedSkinDir, f)), `deployed asset: ${f}`)
}

console.log('== 6. 幂等：第二次 apply() 不应重复写入 ==')
logs.length = 0
mod.apply(fakeCtx)
const secondRun = logs.map((l) => l.join(' ')).join('\n')
check(/already current/.test(secondRun), `second run reports "already current"`)
console.log(`      second-run log: ${secondRun.replace(/\n/g, ' | ')}`)

console.log('== 7. 保护用户改动：改了已有文件后不应被覆盖 ==')
const victim = join(deployedSkinDir, 'skin.css')
writeFileSync(victim, readFileSync(victim, 'utf8') + '\n/* my local tweak */\n')
logs.length = 0
mod.apply(fakeCtx)
check(readFileSync(victim, 'utf8').includes('my local tweak'), 'local tweak survived a re-apply')
check(logs.some((l) => /untouched/.test(l.join(' '))), 'plugin warned instead of overwriting')

console.log('== 8. 旧版本残留 + 用户新增文件：应更新交集、保留新增 ==')
// 模拟「旧版本残留」：造一个源里没有的文件，使插件走更新分支
const stale = join(deployedSkinDir, 'patches.old.css')
writeFileSync(stale, '/* leftover from an older release */\n')
logs.length = 0
mod.apply(fakeCtx)
check(existsSync(stale), 'a file the user added is never deleted')
check(!readFileSync(victim, 'utf8').includes('my local tweak'), 'stale-version branch refreshed the bundled file')
const refreshed = JSON.parse(readFileSync(join(deployedSkinDir, 'skin.json'), 'utf8'))
check(refreshed.version === raw.version, 'manifest refreshed to the bundled version')
check(logs.some((l) => /deployed/.test(l.join(' '))), 'plugin logged the deploy')

console.log('== 9. 强制覆盖开关 ==')
writeFileSync(victim, readFileSync(victim, 'utf8') + '\n/* tweak again */\n')
rmSync(stale, { force: true })
process.env.DSH_SKIN_WHALE_DREAM_FORCE = '1'
logs.length = 0
mod.apply(fakeCtx)
check(!readFileSync(victim, 'utf8').includes('tweak again'), 'FORCE=1 overwrites local edits')
delete process.env.DSH_SKIN_WHALE_DREAM_FORCE

rmSync(deployTarget, { recursive: true, force: true })
delete process.env.DSH_SKINS_HOME

console.log('')
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
