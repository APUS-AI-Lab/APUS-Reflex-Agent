import { describe, expect, it } from 'vitest'
import { adaptCss, adaptBrandContext } from '../scripts/patch-system3-runtime.mjs'

const publishedRegion = String.raw`\0dsh-css:/home/runner/harness/packages/client/ui-conversation/Panel.module.css.mjs`
const patch = `@@ -1,3 +1,3 @@\n //#region ${publishedRegion}\n-const color = "old_root";\n+const color = "old_root active";\n`
const published = 'var Panel_module_css_default = {\n  "root": "old_root"\n};'
const classes = 'var Panel_module_css_default = {\n  "root": "own_root"\n};'

describe('System3 generated CSS patch context', () => {
  it.each([
    String.raw`\0dsh-css:/Users/builder/harness/packages/client/ui-conversation/Panel.module.css.mjs`,
    String.raw`\0dsh-css:D:\a\harness\packages\client\ui-conversation\Panel.module.css.mjs`,
    String.raw`\0dsh-css:D:\a\harness/packages/client\ui-conversation/Panel.module.css.mjs`
  ])('retains the exact target region for %s', (region) => {
    const own = `//#region ${region}\n${classes}`
    expect(adaptCss(patch, published, own)).toBe(
      patch.replace(publishedRegion, region).replaceAll('old_root', 'own_root')
    )
  })

  it('does not substitute a different package with the same CSS basename', () => {
    const own = String.raw`//#region \0dsh-css:D:\a\harness\packages\client\other\Panel.module.css.mjs`
    expect(adaptCss(patch, '', own)).toBe(patch)
  })

  it('rejects different generated origins for the same package stylesheet', () => {
    const suffix = '/packages/client/ui-conversation/Panel.module.css.mjs'
    const own = `//#region /first${suffix}\n//#region /second${suffix}`
    expect(() => adaptCss(patch, '', own)).toThrow('Ambiguous generated CSS region')
  })

  it('preserves executable context even when the target business code differs', () => {
    const region = String.raw`\0dsh-css:D:\a\harness\packages\client\ui-conversation\Panel.module.css.mjs`
    const codePatch = patch + ' existingBusinessRule();\n'
    const own = `//#region ${region}\n${classes}\nchangedBusinessRule();`
    const adapted = adaptCss(codePatch, published, own)
    expect(adapted).toContain(' existingBusinessRule();')
    expect(adapted).not.toContain('changedBusinessRule();')
  })
})


describe('APUS model settings patch context', () => {
  const target = 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'
  const original = 'if (!("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding"'
  const configured = 'if (configured.welcomeNotice && !("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding"'
  it('retains the brand context and reviewed configurable welcome removal', () => {
    const patch = ` welcomeBody: "DeepSeek Harness",\n-${original}\n+onboardingDescription: "DSH will enable models"`
    expect(adaptBrandContext(patch, target, configured)).toBe(` welcomeBody: "APUS Reflex Harness",\n-${configured}\n+onboardingDescription: "APUS Reflex Harness will enable models"`)
  })
  it('rejects an unreviewed welcome implementation', () => {
    expect(() => adaptBrandContext(original, target, original)).toThrow('reviewed welcomeNotice')
  })
  it('does not adapt other packages', () => {
    expect(adaptBrandContext(original, 'other/lib/client.js', '')).toBe(original)
  })
})
