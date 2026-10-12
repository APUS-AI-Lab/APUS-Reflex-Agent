/** Exclude reviewed upstream CI credentials from production resources. */
const fs = require('node:fs')
const path = require('node:path')

const excludedMetadata = [
  'node_modules/debug/.coveralls.yml',
  'node_modules/compression/node_modules/debug/.coveralls.yml',
]

/** Remove only the reviewed CI configuration files; retain package code and licenses. */
function removeExcludedMetadata(root) {
  for (const file of excludedMetadata) fs.rmSync(path.join(root, file), { force: true })
}

/** Reject known upstream CI configuration files in a physical production tree. */
function verifyExcludedMetadata(root) {
  for (const file of excludedMetadata) {
    if (fs.existsSync(path.join(root, file))) throw new Error('Production resources contain excluded CI metadata: ' + file)
  }
}

/** Check both the actual ASAR file listing and its unpacked companion directory. */
function verifyPackagedMetadata(resources) {
  const files = new Set(require('@electron/asar').listPackage(path.join(resources, 'app.asar')).map(file => file.replaceAll('\\', '/').replace(/^\//, '')))
  for (const file of excludedMetadata) {
    if (files.has(file)) throw new Error('Packaged ASAR contains excluded CI metadata: ' + file)
  }
  verifyExcludedMetadata(path.join(resources, 'app.asar.unpacked'))
}

module.exports = { excludedMetadata, removeExcludedMetadata, verifyExcludedMetadata, verifyPackagedMetadata }
