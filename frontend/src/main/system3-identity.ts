/** Preserve fork state independently of the APUS display name and upstream Desktop and reject ambiguous launch profiles. */
import { isAbsolute, join } from 'node:path'
import { PRODUCT_BRAND } from '../shared/product-brand'

/** Resolve the product name and explicit per-install state directory. */
export function system3AppIdentity(appData: string, development: boolean, override?: string): { name: string; userData: string } {
  if (override !== undefined && !isAbsolute(override)) throw new Error('SYSTEM3_DESKTOP_USER_DATA_DIR must be an absolute path')
  return { name: development ? `${PRODUCT_BRAND.fullName} Dev` : PRODUCT_BRAND.fullName,
    userData: override ?? join(appData, development ? 'xdan-system3-dev' : 'xdan-system3') }
}
