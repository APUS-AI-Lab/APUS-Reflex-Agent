import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BRAND } from './prepare-brand.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, '.build/brand/brand-icon.png')
const lightSource = source
const darkSource = source
const destinationDirectory = path.join(
  process.argv[2] || projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-web-frontend',
  'dist'
)
const destination = path.join(destinationDirectory, 'dsh-desktop-logo.png')
const lightDestination = path.join(destinationDirectory, 'dsh-desktop-logo-light.png')
const darkDestination = path.join(destinationDirectory, 'dsh-desktop-logo-dark.png')
const indexPath = path.join(destinationDirectory, 'index.html')
const manifestPath = path.join(destinationDirectory, 'manifest.webmanifest')

/**
 * Swap the Harness favicon link for the desktop's own.
 *
 * The href is matched rather than pinned: 0.1.2-alpha.1 moved it from
 * `/favicon.svg` to `./favicon.svg`. Harness 0.1.7-rc.1 declares separate
 * light and dark favicon links; Desktop uses the same PNG for both themes.
 * @param contents - index.html source.
 * @param file - path shown in the failure message.
 * @returns index.html with the desktop icon link.
 */
function replaceIconLink(contents, file) {
  const desktop = '<link rel="icon" type="image/png" href="/dsh-desktop-logo.png" />'
  if (contents.includes(desktop)) return contents
  const matches = contents.match(/<link rel="icon"[^>]*>/gu) ?? []
  const themedLinks = matches.length === 2
    && matches.some((link) => link.includes('media="(prefers-color-scheme: dark)"'))
    && matches.some((link) => link.includes('media="(prefers-color-scheme: light)"'))
  if (matches.length !== 1 && !themedLinks) {
    throw new Error(
      `Could not update APUS Reflex branding in ${file}: expected one icon link or a light/dark pair, found ${String(matches.length)}`
    )
  }
  return themedLinks
    ? contents.replace(matches[0], desktop).replace(matches[1], '')
    : contents.replace(matches[0], desktop)
}

/**
 * Point the web manifest's icon at the desktop logo.
 *
 * Edited as JSON rather than as text: upstream added `"purpose": "any"` to the
 * entry in 0.1.2-alpha.1, which a pinned multi-line string could not survive,
 * and key order is not a contract. The entry still has to exist.
 * @param contents - manifest source.
 * @param file - path shown in the failure message.
 * @returns manifest JSON with the desktop icon.
 */
function replaceManifestIcon(contents, file) {
  const manifest = JSON.parse(contents)
  manifest.name = BRAND.fullName
  manifest.short_name = BRAND.shortName
  const icons = Array.isArray(manifest.icons) ? manifest.icons : []
  const target = icons.find((icon) => icon?.src === '/dsh-desktop-logo.png')
    ?? icons.find((icon) => typeof icon?.src === 'string' && icon.src.endsWith('favicon.svg'))
  if (target === undefined) {
    throw new Error(`Could not update APUS Reflex branding in ${file}: no icon entry to replace`)
  }
  target.src = '/dsh-desktop-logo.png'
  target.sizes = '1024x1024'
  target.type = 'image/png'
  return `${JSON.stringify(manifest, null, 2)}\n`
}

await mkdir(destinationDirectory, { recursive: true })
await copyFile(source, destination)
await copyFile(lightSource, lightDestination)
await copyFile(darkSource, darkDestination)

const index = await readFile(indexPath, 'utf8')
await writeFile(indexPath, replaceIconLink(index, path.relative(projectRoot, indexPath)).replace(/<title>[^<]*<\/title>/u, `<title>${BRAND.fullName}</title>`))

const manifest = await readFile(manifestPath, 'utf8')
await writeFile(
  manifestPath,
  replaceManifestIcon(manifest, path.relative(projectRoot, manifestPath))
)

console.log(`Installed APUS Reflex brand assets: ${[
  destination,
  lightDestination,
  darkDestination
].map((file) => path.relative(projectRoot, file)).join(', ')}`)
