import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRAND, prepareBrand } from '../scripts/prepare-brand.mjs'
import { PRODUCT_BRAND } from '../src/shared/product-brand'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
describe('APUS brand preparation', () => {
  it('copies the reviewed assets into generated resources while preserving the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'apus-brand-')); roots.push(root)
    const source = join(root, 'harness/apps/web/public')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'brand.json'), JSON.stringify(BRAND))
    for (const name of ['brand-mark.svg', 'brand-icon.png', 'brand-icon.icns', 'brand-icon.ico']) await writeFile(join(source, name), `asset:${name}`)
    await prepareBrand(join(root, 'harness'), join(root, 'desktop'))
    expect(JSON.parse(await readFile(join(root, 'desktop/.build/brand/brand.json'), 'utf8'))).toMatchObject(PRODUCT_BRAND)
    for (const name of ['brand-mark.svg', 'brand-icon.png', 'brand-icon.icns', 'brand-icon.ico']) {
      expect(await readFile(join(root, 'desktop/.build/brand', name), 'utf8')).toBe(await readFile(join(source, name), 'utf8'))
    }
    await writeFile(join(source, 'brand.json'), JSON.stringify({ ...BRAND, fullName: 'Old product' }))
    await expect(prepareBrand(join(root, 'harness'), join(root, 'desktop'))).rejects.toThrow('fullName')
  })
})
