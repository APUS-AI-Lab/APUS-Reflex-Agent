/** Apply reviewed Desktop runtime compatibility changes to the own build, retaining System3 additions. */
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const patchCommand = process.env.SYSTEM3_PATCH_COMMAND ?? 'patch'

function cssMaps(source) {
  const maps = new Map()
  for (const match of source.matchAll(/var (\w+_module_css_default) = \{([\s\S]*?)\n\s*\};/g)) {
    maps.set(match[1], new Map([...match[2].matchAll(/"([^"]+)": "([^"]+)"/g)].map(entry => [entry[1], entry[2]])))
  }
  return maps
}

/** Rebase generated CSS identifiers using module names and exported keys, never fuzzy business-code edits. */
export function adaptCss(patch, installed, own) {
  const ownMaps = cssMaps(own)
  const replacements = new Map()
  for (const [module, names] of cssMaps(installed)) {
    const ownNames = ownMaps.get(module)
    if (!ownNames) continue
    for (const [key, oldValue] of names) {
      const newValue = ownNames.get(key)
      if (!newValue || !oldValue.endsWith(`_${key}`) || !newValue.endsWith(`_${key}`)) continue
      const before = oldValue.slice(0, -key.length)
      const after = newValue.slice(0, -key.length)
      if (replacements.has(before) && replacements.get(before) !== after) throw new Error(`Ambiguous generated CSS mapping: ${module}`)
      replacements.set(before, after)
    }
  }
  for (const [before, after] of replacements) patch = patch.replaceAll(before, after)
  const regionSuffix = path => {
    const normalized = path.replaceAll('\\', '/')
    const start = normalized.lastIndexOf('/packages/')
    return start < 0 ? undefined : normalized.slice(start)
  }
  const regions = [...own.matchAll(/^\s*\/\/#region (.*\.css\.mjs)$/gm)].map(match => match[1])
  patch = patch.replace(/(\/\/#region )(.*\.css\.mjs)/g, (whole, prefix, path) => {
    const suffix = regionSuffix(path)
    const matches = suffix === undefined ? [] : [...new Set(regions.filter(region => regionSuffix(region) === suffix))]
    if (matches.length > 1) throw new Error(`Ambiguous generated CSS region: ${suffix}`)
    return matches.length === 1 ? prefix + matches[0] : whole
  })
  return patch
}

/** Keep the reviewed import and RPC insertions independent of generated source-location lines. */
function adaptApiContext(chunk, target) {
  if (!target.includes('/dsh-api-session-controller/')) return chunk
  return chunk.replace(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n([\s\S]*?)(?=^@@ |$(?![\s\S]))/gm,
    (whole, oldStart, _oldCount, newStart, _newCount, body) => {
      let leading = 0
      let trailing = 0
      if (target.endsWith('/lib/index.js') && body.includes('-import { mkdir } from "node:fs/promises";')) {
        leading = 3; trailing = 3
      } else if (/\/typert\.(?:host|remote-client)\.js$/.test(target)
        && body.includes("+      id: '@deepseek-ai/dsh-api-session-controller#session/delete'")) leading = 3
      else return whole
      const lines = body.trimEnd().split('\n')
      if (lines.slice(0, leading).some(line => !line.startsWith(' ')) || (trailing && lines.slice(-trailing).some(line => !line.startsWith(' ')))) {
        throw new Error('Reviewed API compatibility context changed')
      }
      const retained = lines.slice(leading, trailing ? -trailing : undefined)
      const oldCount = retained.filter(line => !line.startsWith('+')).length
      const newCount = retained.filter(line => !line.startsWith('-')).length
      return `@@ -${Number(oldStart) + leading},${oldCount} +${Number(newStart) + leading},${newCount} @@\n${retained.join('\n')}\n`
    })
}

/** Rebase only reviewed locale copy and welcome configuration; executable hunks still require exact context. */
export function adaptBrandContext(chunk, target, own) {
  if (target.endsWith('/dsh-client-ui-chat/lib/client.js')) {
    const accountCopy = [
      ['任务已因退出 DeepSeek 登录而停止。', '任务已因退出模型服务账号登录而停止。'],
      ['请先登录 DeepSeek，并确认请求地址支持账号认证。', '请先登录模型服务账号，并确认请求地址支持账号认证。'],
      ['Stopped because you signed out of DeepSeek.', 'Stopped because you signed out of your model provider account.'],
      ['Sign in to DeepSeek and ensure the request destination supports account authentication.',
        'Sign in to your model provider and ensure the request destination supports account authentication.']
    ]
    return chunk.replace(/^ (.*"message\.failure\.account(?:SignedOut|SignInRequired)":.*)$/gm, (_, line) => {
      for (const [before, after] of accountCopy) line = line.replace(before, after)
      return ` ${line}`
    })
  }
  if (!target.endsWith('/dsh-client-ui-settings-models/lib/client.js')) return chunk
  chunk = chunk.replace(/^ (.*welcomeBody:.*)$/gm, (_, line) => ` ${line
    .replaceAll('DeepSeek Harness', 'APUS Reflex')
    .replaceAll('DSH plugin ecosystem', 'APUS Reflex plugin ecosystem')
    .replaceAll('DSH 插件生态', 'APUS Reflex 插件生态')}`)
  chunk = chunk.replace(/^-(.*onboardingDescription:.*)$/gm, (_, line) => `-${line
    .replace('Configure the official DeepSeek provider to start building.', 'Connect DeepSeek with an API Key here, or skip this step and configure another provider in Settings → Models.')
    .replace('配置 DeepSeek 官方模型，即可开始使用。', '在此填写 API Key 连接 DeepSeek；也可跳过，在设置 → 模型中配置其他提供方。')}`)
  const published = 'if (!("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding"'
  const configured = 'if (configured.welcomeNotice && !("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding"'
  if (!own.includes(configured)) throw new Error('Own model settings must expose the reviewed welcomeNotice option')
  chunk = chunk.replace(published, configured)
  return chunk.replaceAll('APUS Reflex Harness', 'APUS Reflex').replaceAll('DSH will enable', 'APUS Reflex will enable').replaceAll('DSH 会自动启用', 'APUS Reflex 会自动启用')
}

/** Apply all runtime-JavaScript hunks; declarations stay those emitted by the own build. */
export async function patchSystem3Runtime(stage, appRoot) {
  const receipts = []
  for (const name of (await readdir(join(appRoot, 'patches'))).filter(name => name.endsWith('.patch')).sort()) {
    const original = await readFile(join(appRoot, 'patches', name), 'utf8')
    const chunks = original.split(/(?=^diff --git )/m)
    const patches = []
    const targets = []
    for (let chunk of chunks) {
      const target = chunk.match(/^\+\+\+ b\/(.+\.js)$/m)?.[1]
      if (!target) continue
      const own = await readFile(join(stage, target), 'utf8')
      const installed = await readFile(join(appRoot, target), 'utf8')
      chunk = adaptBrandContext(adaptApiContext(adaptCss(chunk, installed, own), target), target, own)
      patches.push(chunk)
      targets.push(target)
    }
    if (!patches.length) continue
    const patchPath = join(stage, '.desktop-compatibility.patch')
    const patch = patches.join('')
    await writeFile(patchPath, patch)
    try {
      execFileSync(patchCommand, ['--dry-run', '--batch', '--forward', '--fuzz=0', '-p1', '-i', '.desktop-compatibility.patch'], { cwd: stage, stdio: 'pipe' })
      execFileSync(patchCommand, ['--batch', '--forward', '--fuzz=0', '-p1', '-i', '.desktop-compatibility.patch'], { cwd: stage, stdio: 'pipe' })
    } catch (error) {
      throw new Error(`Desktop compatibility patch ${name} requires review: ${String(error.stdout ?? error.message)}`, { cause: error })
    } finally { await unlink(patchPath) }
    for (const target of targets) execFileSync(process.execPath, ['--check', join(stage, target)], { stdio: 'pipe' })
    receipts.push({ name, sourceSha256: createHash('sha256').update(original).digest('hex'),
      runtimePatchSha256: createHash('sha256').update(patch).digest('hex'),
      declarations: 'own-build-retained', manifest: 'closure-owned',
      targets: await Promise.all(targets.map(async path => ({ path,
        sha256: createHash('sha256').update(await readFile(join(stage, path))).digest('hex') }))) })
  }
  await writeFile(join(stage, 'desktop-patch-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`)
}
