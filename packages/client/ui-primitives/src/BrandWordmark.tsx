import type { IconProps } from './icons/props.ts'
import { FISH_LOGO_PATH } from './FishLogo.tsx'
import { BRAND_NAME, BRAND_WORDMARK } from './brand.ts'

/** Display options for the APUS brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading letter mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the compact APUS wordmark with the complete accessible product name.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading letter mark.
 * @returns the labeled wordmark svg.
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 182 : 156
  return (
    <svg width={(size * width) / 24} height={size} className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'} fill="currentColor"
      role="img" aria-label={BRAND_NAME}>
      {includeMark && <path d={FISH_LOGO_PATH} transform="scale(.375)" fillRule="evenodd" />}
      <text x="28" y="17" fontFamily="Arial, sans-serif" fontSize="16" fontWeight="500" letterSpacing=".5">{BRAND_WORDMARK}</text>
    </svg>
  )
}
