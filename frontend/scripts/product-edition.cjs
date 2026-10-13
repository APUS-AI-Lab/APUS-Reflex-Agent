/** Product editions share application identity and differ only in bundled Office engines. */
const fs = require('node:fs')
const path = require('node:path')

/** Resolve a build edition; unknown values fail before producing an artifact. */
function resolveEdition(value = 'full') {
  if (value !== 'full' && value !== 'lite') throw new Error('Product edition must be full or lite.')
  return value
}

/** Read an optional explicit edition, falling back to the product build environment. */
function resolveEditionFromArgs(args, environment = process.env) {
  const occurrences = args.filter(value => value === '--edition' || value.startsWith('--edition='))
  if (occurrences.length > 1) throw new Error('Specify --edition only once.')
  const option = occurrences[0]
  const value = option === '--edition' ? args[args.indexOf(option) + 1] : option?.slice('--edition='.length)
  if (option && (!value || value.startsWith('--'))) throw new Error('--edition requires full or lite.')
  return resolveEdition(value ?? environment.APUS_PRODUCT_EDITION ?? 'full')
}

/** The last product overlay disables conversion before the Lite provider can import its absent engine. */
function editionPatch(edition) {
  return resolveEdition(edition) === 'lite' ? '- id: office-to-pdf\n  disabled: true\n' : '[]\n'
}

/** Identify only the independently distributed LibreOffice engine family. */
function isOfficeEnginePath(relative) {
  return /(?:^|\/)node_modules\/@deepseek-ai\/libreoffice-kit(?:-[^/]+)?(?:\/|$)/.test(relative.replaceAll('\\', '/'))
}

/** Classify files that must not survive into the production dependency tree. */
function excludedProductionPath(relative, { edition = 'full', platform = process.platform, arch = process.arch } = {}) {
  resolveEdition(edition)
  const normalized = relative.replaceAll('\\', '/')
  if (edition === 'lite' && isOfficeEnginePath(normalized)) return 'Office engine'
  if (normalized.endsWith('.map')) return 'source map'
  const prebuild = /(?:^|\/)node_modules\/node-pty\/prebuilds\/([^/]+)(?:\/|$)/.exec(normalized)
  if (prebuild && prebuild[1] !== `${platform}-${arch}`) return 'foreign node-pty prebuild'
  return undefined
}

/** Prune a physical staging tree; never follow links into source installations. */
function pruneRuntimeFiles(root, options) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Production staging root must not be a symlink.')
  const removed = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Production staging tree contains a symlink: ' + file)
      const relative = path.relative(root, file).split(path.sep).join('/')
      const reason = excludedProductionPath(relative, options)
      if (reason) {
        fs.rmSync(file, { recursive: true, force: true })
        removed.push({ path: relative, reason })
      } else if (entry.isDirectory()) visit(file)
    }
  }
  visit(root)
  return removed
}

/** Reject absent cleanup or engine files accidentally returned to a physical product tree. */
function verifyEditionFiles(root, edition, options = {}) {
  const settings = { ...options, edition: resolveEdition(edition) }
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Production dependency tree contains a symlink: ' + file)
      const relative = path.relative(root, file).split(path.sep).join('/')
      const reason = excludedProductionPath(relative, settings)
      if (reason) throw new Error(`Production ${edition} tree contains excluded ${reason}: ${relative}`)
      if (entry.isDirectory()) visit(file)
    }
  }
  visit(root)
}

/** Verify the edition recorded by the closed runtime and its actual dependency files. */
function verifyEditionRuntime(root, edition) {
  const expected = resolveEdition(edition)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'))
  if (manifest.edition !== expected) throw new Error('Runtime edition differs from the selected product edition.')
  if (manifest.editionPatch !== 'product-edition.patch.yml') throw new Error('Runtime edition overlay is missing.')
  if (fs.readFileSync(path.join(root, manifest.editionPatch), 'utf8') !== editionPatch(expected)) throw new Error('Runtime edition overlay differs from the selected product edition.')
  verifyEditionFiles(root, expected, { platform: manifest.platform, arch: manifest.arch })
  return manifest
}

/** Require the declared native engine, or the WASM distribution on targets without a native declaration. */
function verifyOfficeEngine(root, platform, arch) {
  const kit = path.join(root, 'node_modules/@deepseek-ai/libreoffice-kit')
  const manifest = JSON.parse(fs.readFileSync(path.join(kit, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/libreoffice-kit') throw new Error('Full product Office engine identity is invalid.')
  const native = `@deepseek-ai/libreoffice-kit-${platform}-${arch}`
  const engine = Object.hasOwn(manifest.optionalDependencies ?? {}, native) ? native : '@deepseek-ai/libreoffice-kit-wasm'
  const entry = path.join(root, 'node_modules', engine, 'package.json')
  if (!fs.existsSync(entry)) throw new Error(`Full product requires its declared Office engine: ${engine}`)
  return engine
}

/** Apply edition names and dependency filters without changing application or installation identity. */
function createBuilderConfig(base, edition = 'full', platform = process.platform, arch = process.arch) {
  const selected = resolveEdition(edition)
  const config = structuredClone(base)
  const exclusions = ['!**/*.map', `!**/node_modules/node-pty/prebuilds/!(${platform}-${arch}){,/**/*}`]
  if (selected === 'lite') exclusions.push('!**/node_modules/@deepseek-ai/libreoffice-kit{,/**/*}', '!**/node_modules/@deepseek-ai/libreoffice-kit-*{,/**/*}')
  // Keep one root FileSet: the builder merges separated string groups in reverse order.
  // A later positive node_modules pattern would otherwise re-include excluded engines.
  const rootPatterns = config.files.filter(file => typeof file === 'string')
  const mappings = config.files.filter(file => typeof file !== 'string')
    .map(file => ({ ...file, filter: [...file.filter, '!**/*.map'] }))
  config.files = [{ from: '.', to: '.', filter: [...rootPatterns, ...exclusions] }, ...mappings]
  config.win.files.push(...exclusions)
  config.extraMetadata = { ...config.extraMetadata, apusProductEdition: selected }
  config.artifactName = `apus-reflex-agent-${selected}-\${os}-\${arch}.\${ext}`
  config.nsis.artifactName = `apus-reflex-agent-${selected}-windows-\${arch}-setup.\${ext}`
  config.deb.artifactName = `apus-reflex-agent-${selected}-linux-x64.deb`
  config.directories.output = `${base.directories.output}/${selected}`
  return config
}

module.exports = { resolveEdition, resolveEditionFromArgs, editionPatch, isOfficeEnginePath, excludedProductionPath,
  pruneRuntimeFiles, verifyEditionFiles, verifyEditionRuntime, verifyOfficeEngine, createBuilderConfig }
