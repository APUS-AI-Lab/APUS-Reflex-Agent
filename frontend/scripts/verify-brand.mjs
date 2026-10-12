/** Fail the desktop build when canonical brand resources have not been prepared. */
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateBrand } from './prepare-brand.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const brand = validateBrand(JSON.parse(await readFile(join(root, '.build/brand/brand.json'), 'utf8')))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (pkg.build.productName !== brand.fullName) throw new Error('Desktop productName differs from the prepared Harness brand')
for (const name of ['brand-mark.svg', 'brand-icon.png', 'brand-icon.icns', 'brand-icon.ico']) await access(join(root, '.build/brand', name))
