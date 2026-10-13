const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'ai.xdan.system3.dev',
  productName: `${packageJson.build.productName} Dev`,
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'xdan-system3-dev',
    productName: `${packageJson.build.productName} Dev`,
    dshDesktopChannel: 'development'
  },
  artifactName: 'apus-reflex-harness-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'apus-reflex-harness-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
