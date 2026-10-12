import { BRAND_LOGO_DATA_URI } from './brand-artwork.ts'
import type { IconProps } from './icons/props.ts'

/** Square viewBox of the APUS bird mark; legacy export retained for consumers. */
export const FISH_LOGO_VIEWBOX = { width: 64, height: 64 }

/** Legacy compatibility A geometry; use BRAND_LOGO_DATA_URI for the current bird artwork. */
export const FISH_LOGO_PATH = 'M32 8 7 56h12l5-10h16l5 10h12L32 8Zm0 22 5 10H27l5-10Z'

/**
 * Render the APUS bird mark through the existing brand component API.
 * @param props.size - width and height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns decorative logo svg; the owning surface supplies its accessible name.
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <image href={BRAND_LOGO_DATA_URI} width="64" height="64" />
    </svg>
  )
}
