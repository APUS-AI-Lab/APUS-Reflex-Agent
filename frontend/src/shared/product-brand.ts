/** APUS display identity; persistent installation identifiers remain compatible. */
export const PRODUCT_BRAND = {
  fullName: 'APUS Reflex',
  shortName: 'APUS / REFLEX',
  zhName: '瞬策',
  tagline: '瞬时执行，深度思考',
  modelAsHarness: 'Model as Harness'
} as const

/** This distribution has no upstream reporting consent or upstream update channel. */
export const PRODUCT_SERVICES = {
  upstreamDiagnostics: false,
  upstreamUpdates: false
} as const
