import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageMetadata {
  version?: unknown
  dependencies?: Record<string, unknown>
}

function readPackageMetadata(path: string): PackageMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata
  } catch {
    return undefined
  }
}

function validVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function bundledHarnessVersion(appPath: string): string | undefined {
  const installedMetadata = readPackageMetadata(
    join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  )
  const installedVersion = validVersion(installedMetadata?.version)
  if (installedVersion) return installedVersion

  const appMetadata = readPackageMetadata(join(appPath, 'package.json'))
  return validVersion(appMetadata?.dependencies?.['@deepseek-ai/dsh'])
}

export function aboutDetail(
  desktopVersion: string,
  harnessVersion: string | undefined,
  locale: 'en' | 'zh'
): string {
  const harness = harnessVersion ?? (locale === 'zh' ? '未知' : 'Unknown')
  if (locale === 'zh') {
    return `APUS Reflex Harness 版本：${desktopVersion}\n内置 Harness 版本：${harness}\n\n瞬策 · 瞬时执行，深度思考\nModel-as-a-Harness\nHarness 随 APUS Reflex Harness 更新。\n\n感谢 DSH Desktop（DataElement）与 DeepSeek Harness（DeepSeek）及开源贡献者。原 MIT 版权与第三方许可证随应用保留。`
  }
  return `APUS Reflex Harness version: ${desktopVersion}\nBundled Harness version: ${harness}\n\n瞬策 · 瞬时执行，深度思考\nModel-as-a-Harness\nHarness is updated with APUS Reflex Harness.\n\nThanks to DSH Desktop (DataElement), DeepSeek Harness (DeepSeek), and open-source contributors. Original MIT notices and third-party licenses are included.`
}
