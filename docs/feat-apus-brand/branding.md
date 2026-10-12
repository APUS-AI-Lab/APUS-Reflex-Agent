# APUS Reflex branding and assembly

English | [中文](branding.zh.md)

APUS Reflex uses the Chinese name “瞬策”, the slogan “瞬时执行，深度思考” (Instant action. Deep thinking.), and the positioning Model as Harness. The management scope in the report is a strategic objective; brand copy does not imply that capabilities such as memory have been integrated or accepted.

## Authoritative inputs

The static Web brand definition lives in `apps/web/public/brand.json`, beside the canonical vector `brand-mark.svg`. Shared UI wordmarks and marks come from `packages/client/ui-primitives`; the existing `BrandWordmark` and `FishLogo` exports remain compatible with callers while displaying the APUS wordmark and letter mark.

After installing repository dependencies, run `pnpm exec tsx apps/desktop/scripts/generate-brand-assets.ts` to generate Web favicons, application PNG/ICO files, native desktop resources, and installer wordmarks from the canonical vector. On macOS, the script also generates ICNS using the system iconutil; other platforms use the committed ICNS. The script uses the existing sharp dependency.

APUS-Reflex-Frontend validates and copies these brand inputs into `.build/brand` during preparation; installers and native pages consume those resources. After changing Harness, update the pinned Harness commit in Frontend before preparing the Runtime and packaging. Renaming a repository does not change installed applications.

## Compatibility and attribution

`@deepseek-ai/*`, `dsh`, System3 plugin identifiers, Session fields, existing application IDs, protocols, and data directories retain their technical compatibility roles. DeepSeek models and account services name their actual provider; licenses and third-party contributions preserve attribution. Historical acceptance records are not rewritten for the rename.

APUS products must not infer permission to enable upstream updates or diagnostics from their display name. The standalone Frontend disables these services through explicit product policy. The native Harness desktop also disables feed checks by default, including when upstream metadata is packaged; mandatory-update queries run only with explicit policy configuration. Integrating and publishing an APUS update service requires separate configuration and acceptance.
