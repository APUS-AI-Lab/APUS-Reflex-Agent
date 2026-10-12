/** Record deployed package identities after materialization and desktop patches. */
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { verifyExcludedMetadata } = require('./package-metadata-policy.cjs')

const inventoryFileName = 'runtime-dependencies.json'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Enumerate physical installed packages, including scoped and nested dependencies. */
function runtimeDependencies(root) {
  const packages = []
  const entries = directory => fs.readdirSync(directory, { withFileTypes: true })
  const requirePhysical = (directory, entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Runtime dependency tree contains a symlink: ${path.join(directory, entry.name)}`)
  }
  function walk(directory) {
    for (const entry of entries(directory)) {
      requirePhysical(directory, entry)
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name === 'node_modules') modules(child)
      else walk(child)
    }
  }
  function installed(directory) {
    const file = path.join(directory, 'package.json')
    if (!fs.lstatSync(file).isFile()) throw new Error(`Runtime package manifest is not a physical file: ${file}`)
    const bytes = fs.readFileSync(file)
    const manifest = JSON.parse(bytes.toString('utf8'))
    if (typeof manifest.name !== 'string' || !manifest.name || typeof manifest.version !== 'string' || !manifest.version) {
      throw new Error(`Runtime package needs a name and version: ${file}`)
    }
    packages.push({ path: path.relative(root, file).split(path.sep).join('/'), name: manifest.name, version: manifest.version, packageJsonSha256: sha256(bytes) })
    walk(directory)
  }
  function modules(directory) {
    if (!fs.lstatSync(directory).isDirectory()) throw new Error(`Runtime node_modules is not a physical directory: ${directory}`)
    for (const entry of entries(directory)) {
      requirePhysical(directory, entry)
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name.startsWith('.')) walk(child)
      else if (entry.name.startsWith('@')) {
        for (const scoped of entries(child)) {
          requirePhysical(child, scoped)
          if (scoped.isDirectory()) installed(path.join(child, scoped.name))
        }
      } else installed(child)
    }
  }
  modules(path.join(root, 'node_modules'))
  packages.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return { formatVersion: 1, packages }
}

/** Write the observed dependency inventory and return its runtime-manifest descriptor. */
function writeDependencyInventory(root) {
  const bytes = Buffer.from(`${JSON.stringify(runtimeDependencies(root), null, 2)}\n`)
  fs.writeFileSync(path.join(root, inventoryFileName), bytes)
  return { path: inventoryFileName, sha256: sha256(bytes) }
}

/** Reject inventory drift or a deployed package added, removed, or replaced after preparation. */
function verifyDependencyInventory(root, manifest) {
  verifyExcludedMetadata(root)
  const descriptor = manifest.dependencyInventory
  if (manifest.mode !== 'deployed' || descriptor?.path !== inventoryFileName || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
    throw new Error('A deployed runtime dependency inventory is required; prepare the runtime again.')
  }
  const file = path.join(root, inventoryFileName)
  if (!fs.lstatSync(file).isFile()) throw new Error('Runtime dependency inventory must be a physical file.')
  const bytes = fs.readFileSync(file)
  if (sha256(bytes) !== descriptor.sha256) throw new Error('Runtime dependency inventory hash differs from its manifest.')
  const observed = `${JSON.stringify(runtimeDependencies(root), null, 2)}\n`
  if (bytes.toString('utf8') !== observed) throw new Error('Runtime dependency inventory differs from installed package manifests.')
  return descriptor
}

module.exports = { inventoryFileName, runtimeDependencies, writeDependencyInventory, verifyDependencyInventory }
