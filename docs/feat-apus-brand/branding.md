# APUS Reflex Harness branding and assembly

English | [中文](branding.zh.md)

APUS Reflex Harness uses the Chinese name “瞬策”, the slogan “瞬时执行，深度思考” (Instant action. Deep thinking.), and the positioning Model-as-a-Harness. The management scope in the report is a strategic objective; brand copy does not imply that capabilities such as memory have been integrated or accepted.

## Authoritative inputs

The static Web brand definition lives in `apps/web/public/brand.json`. The single original image is the adjacent `brand-source.webp`: the user-supplied 140×140 transparent gradient bird raster. `brand-mark.svg` embeds a lossless PNG representation, not a vector redraw. The shared UI keeps the `BrandWordmark` and `FishLogo` component APIs and displays the APUS bird and wordmark using PNG data generated from that image.

After installing repository dependencies, run `pnpm exec tsx apps/desktop/scripts/generate-brand-assets.ts` to generate Web favicons, shared React brand data, application PNG/ICO files, native desktop resources and installer wordmarks from that image, preserving its colors, proportions and transparency. On macOS, the script also generates ICNS using the system iconutil; other platforms use the committed ICNS. The script uses the existing sharp dependency.

The `frontend/` desktop host validates and copies these brand inputs into `.build/brand` during preparation; installers and native pages consume those resources. Prepare the runtime from the same checkout after changing Harness. Renaming a repository does not change installed applications.

## Compatibility and attribution

`@deepseek-ai/*`, `dsh`, System3 plugin identifiers, Session fields, existing application IDs, protocols, and data directories retain their technical compatibility roles. DeepSeek models and account services name their actual provider; licenses and third-party contributions preserve attribution. Historical acceptance records are not rewritten for the rename.

APUS products must not infer permission to enable upstream updates or diagnostics from their display name. The desktop host disables these services through explicit product policy. The native Harness desktop also disables feed checks by default, including when upstream metadata is packaged; mandatory-update queries run only with explicit policy configuration. Integrating and publishing an APUS update service requires separate configuration and acceptance.
