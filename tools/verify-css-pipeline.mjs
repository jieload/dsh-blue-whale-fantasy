/**
 * 用皮肤中心真实的 CSS 安全管线（lightningcss 解析 + 强制作用域 + 白名单）
 * 跑一遍 skin.css / patches.css。
 *
 * 这一步很关键：白名单是 fail-closed 的，任何违规都会让整个样式表 500，
 * 皮肤就彻底没样式。本地只看 @import / url() 是不够的，必须过真实管线。
 *
 * 用法：node tools/verify-css-pipeline.mjs [--pkg <skin-center 包目录>]
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skinRoot = resolve(here, '..', 'skin-assets')
const SKIN_ID = 'whale-dream'

const argPkg = process.argv.indexOf('--pkg')
const pkgDir = argPkg !== -1
  ? resolve(process.argv[argPkg + 1])
  : join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@linxin666', 'dsh-client-ui-skin-center')

const candidates = [
  join(pkgDir, 'lib', 'index.js'),
  join(pkgDir, 'lib', 'css-safety.js'),
]

let transformSkinCss
let SkinCssSafetyError
let loadedFrom
for (const c of candidates) {
  if (!existsSync(c)) continue
  const mod = await import(pathToFileURL(c).href).catch(() => null)
  if (mod && typeof mod.transformSkinCss === 'function') {
    transformSkinCss = mod.transformSkinCss
    SkinCssSafetyError = mod.SkinCssSafetyError
    loadedFrom = c
    break
  }
}

if (transformSkinCss === undefined) {
  console.error('皮肤中心没有导出 transformSkinCss（构建产物未导出该内部函数）。')
  console.error('这不算失败——请在 GUI 里实际套用皮肤来确认渲染。')
  process.exit(3)
}

console.log(`CSS 管线来自: ${loadedFrom}`)
let failed = 0
for (const [file, deriveFallbacks] of [['skin.css', true], ['patches.css', false]]) {
  const css = readFileSync(join(skinRoot, file), 'utf8')
  try {
    const { code, warnings } = transformSkinCss(css, { skinId: SKIN_ID, filename: file, deriveFallbacks })
    console.log(`\n== ${file} ==`)
    console.log(`  ok   通过白名单，输出 ${code.length} 字符`)
    if (warnings.length > 0) {
      console.log(`  警告 ${warnings.length} 条：`)
      for (const w of warnings) console.log(`    - ${w}`)
    } else {
      console.log('  ok   无警告')
    }
    const scoped = (code.match(new RegExp(`html\\[data-dsh-skin="${SKIN_ID}"\\]`, 'g')) ?? []).length
    console.log(`  ok   作用域生效：出现 ${scoped} 处 html[data-dsh-skin="${SKIN_ID}"]`)
    if (scoped === 0) { console.log('  FAIL 作用域没有加上'); failed += 1 }
  } catch (error) {
    failed += 1
    console.log(`\n== ${file} ==`)
    console.log(`  FAIL ${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`)
    if (Array.isArray(error?.violations)) {
      for (const v of error.violations) console.log(`    - ${v}`)
    }
  }
}

console.log('')
console.log(failed === 0 ? 'CSS PIPELINE OK' : `${failed} FILE(S) FAILED THE CSS PIPELINE`)
process.exit(failed === 0 ? 0 : 1)
