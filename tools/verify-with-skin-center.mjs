/**
 * 用**真实安装的皮肤中心**校验皮肤是否能被发现并接受。
 * 这比我自己重放规则更权威：走的是仓库里真正的那份 loadSkinCatalog + validateSkinManifestV2。
 *
 * 用法：
 *   node tools/verify-with-skin-center.mjs
 *   node tools/verify-with-skin-center.mjs --pkg <skin-center 包目录>
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argPkg = process.argv.indexOf('--pkg')
const pkgDir = argPkg !== -1
  ? resolve(process.argv[argPkg + 1])
  : join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')

if (!existsSync(pkgDir)) {
  console.error(`找不到皮肤中心：${pkgDir}`)
  console.error('先装它：dsh plugin add @linxin666/dsh-client-ui-skin-center')
  process.exit(2)
}

const entry = join(pkgDir, 'lib', 'index.js')
const mod = await import(pathToFileURL(entry).href)

if (typeof mod.loadSkinCatalog !== 'function') {
  console.error('皮肤中心没有导出 loadSkinCatalog —— 版本不匹配，无法这样校验。')
  process.exit(2)
}

const TARGET = 'whale-dream'
const userDir = join(homedir(), '.dsh', 'skins')
console.log(`皮肤中心: ${pkgDir}`)
console.log(`用户皮肤目录: ${userDir}`)

const catalog = mod.loadSkinCatalog({ userDir })
console.log(`目录中皮肤数: ${catalog.skins.length}`)

console.log('\n== 诊断（被剔除的目录）==')
const mine = catalog.diagnostics.filter((d) => d.subject === TARGET)
if (catalog.diagnostics.length === 0) console.log('  (无)')
for (const d of catalog.diagnostics) {
  const mark = d.subject === TARGET ? ' <== 我们的' : ''
  console.log(`  [${d.origin}] ${d.subject}${mark}`)
  for (const e of d.errors) console.log(`      - ${e}`)
}

console.log('\n== 目标皮肤是否进入目录 ==')
const found = catalog.skins.find((s) => s.manifest.id === TARGET)
if (found === undefined) {
  console.log(`  未找到 "${TARGET}"。`)
  process.exit(1)
}
console.log(`  ok   id=${found.manifest.id}`)
console.log(`  ok   origin=${found.origin}  (user 表示来自 $DSH_HOME/skins，会覆盖同名内置皮肤)`)
console.log(`  ok   name=${found.manifest.name} / ${found.manifest.nameEn}`)
console.log(`  ok   version=${found.manifest.version}  order=${found.manifest.order}`)
console.log(`  ok   stylesheet=${found.manifest.contributes.stylesheet}`)
console.log(`  ok   patches=${found.manifest.contributes.patches ?? '(none)'}`)
console.log(`  ok   backgroundMedia=${found.manifest.contributes.backgroundMedia?.dark?.src ?? '(none)'}`)
console.log(`  ok   hooks=${found.manifest.facets?.client ? 'declared' : 'none (纯资产，不执行代码)'}`)

console.log('\n== 目录级警告（token 契约缺口等）==')
if (found.warnings.length === 0) console.log('  (无警告)')
for (const w of found.warnings) console.log(`  - ${w}`)

console.log(`\n结果：皮肤 "${TARGET}" 已被真实皮肤中心接受（origin=${found.origin}）。`)
process.exit(0)
