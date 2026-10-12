/** Import the reviewed Harness brand into generated Desktop resources. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BRAND = Object.freeze({
  fullName: 'APUS Reflex Harness', shortName: 'APUS / REFLEX', zhName: '瞬策',
  tagline: '瞬时执行，深度思考', modelAsHarness: 'Model-as-a-Harness',
  mark: 'brand-mark.svg', icon: 'brand-icon.png'
})

/** Reject missing, incompatible or path-bearing brand inputs before copying assets. */
export function validateBrand(value) {
  for (const [key, expected] of Object.entries(BRAND)) {
    if (value?.[key] !== expected) throw new Error(`Harness brand ${key} must be ${expected}`)
  }
  return value
}

/** Copy source assets without changing Harness or tracked Desktop files. */
export async function prepareBrand(sourceRoot, appRoot) {
  const source = join(sourceRoot, 'apps/web/public')
  const brand = validateBrand(JSON.parse(await readFile(join(source, 'brand.json'), 'utf8')))
  const destination = join(appRoot, '.build/brand')
  await mkdir(destination, { recursive: true })
  for (const name of [brand.mark, brand.icon, 'brand-icon.icns', 'brand-icon.ico']) {
    await copyFile(join(source, name), join(destination, name))
  }
  await writeFile(join(destination, 'brand.json'), `${JSON.stringify(brand, null, 2)}\n`)
  return brand
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2] || process.env.SYSTEM3_HARNESS_ROOT
  if (!source) throw new Error('Brand preparation requires the reviewed Harness source path')
  await prepareBrand(resolve(source), fileURLToPath(new URL('..', import.meta.url)))
}
