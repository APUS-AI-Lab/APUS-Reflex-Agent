import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

describe('integrated Harness brand consumers', () => {
  it('prepares the real source identity and installs matching desktop page metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'apus-integrated-brand-')); roots.push(root)
    const app = join(root, 'desktop')
    const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
    const brand = await prepareBrand(sourceRoot, app)
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { build: { productName: string } }
    expect(brand).toMatchObject(PRODUCT_BRAND)
    expect(pkg.build.productName).toBe(brand.fullName)
    await mkdir(join(app, 'scripts'), { recursive: true })
    for (const name of ['install-brand-assets.mjs', 'prepare-brand.mjs']) {
      await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(app, 'scripts', name))
    }
    const dist = join(app, 'node_modules/@deepseek-ai/dsh-web-frontend/dist')
    await mkdir(dist, { recursive: true })
    await writeFile(join(dist, 'index.html'), '<title>Previous brand</title><link rel="icon" type="image/svg+xml" href="./favicon.svg" />')
    await writeFile(join(dist, 'manifest.webmanifest'), JSON.stringify({
      name: 'Previous brand', short_name: 'Previous brand', start_url: './',
      icons: [{ src: './favicon.svg', type: 'image/svg+xml', sizes: 'any' }]
    }))
    execFileSync(process.execPath, [join(app, 'scripts/install-brand-assets.mjs')])
    expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain(`<title>${brand.fullName}</title>`)
    expect(JSON.parse(await readFile(join(dist, 'manifest.webmanifest'), 'utf8'))).toMatchObject({
      name: brand.fullName, short_name: brand.shortName, start_url: './',
      icons: [{ src: '/dsh-desktop-logo.png', type: 'image/png', sizes: '1024x1024' }]
    })
    expect(await readFile(join(dist, 'dsh-desktop-logo.png'))).toEqual(await readFile(join(app, '.build/brand/brand-icon.png')))
  })
})
