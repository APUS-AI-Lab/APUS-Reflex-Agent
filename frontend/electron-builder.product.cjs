/** Explicit Full/Lite production configuration; direct packaging defaults to Full. */
const { createBuilderConfig, resolveEdition } = require('./scripts/product-edition.cjs')
module.exports = createBuilderConfig(require('./package.json').build, resolveEdition(process.env.APUS_PRODUCT_EDITION ?? 'full'))
