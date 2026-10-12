import type { IconProps } from './icons/props.ts'

import { BRAND_IMAGE_DATA_URL } from './brand-image.ts'

/** Square viewBox retained for consumers of the legacy brand component API. */
export const FISH_LOGO_VIEWBOX = { width: 64, height: 64 }

/**
 * Render the original-color APUS bird through the existing brand component API.
 * @param props.size - width and height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns decorative logo svg; the owning surface supplies its accessible name.
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <image width="64" height="64" href={BRAND_IMAGE_DATA_URL} />
    </svg>
  )
}
