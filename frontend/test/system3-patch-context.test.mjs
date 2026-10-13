import { describe, expect, it } from 'vitest'
import { en, zh } from '../../packages/client/ui-settings-models/src/client/locales.ts'
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
    expect(adaptBrandContext(patch, target, configured)).toBe(` welcomeBody: "APUS Reflex",\n-${configured}\n+onboardingDescription: "APUS Reflex will enable models"`)
  })
  it('rejects an unreviewed welcome implementation', () => {
    expect(() => adaptBrandContext(original, target, original)).toThrow('reviewed welcomeNotice')
  })
  it('does not adapt other packages', () => {
    expect(adaptBrandContext(original, 'other/lib/client.js', '')).toBe(original)
  })
})


describe('APUS neutral provider patch context', () => {
  const chat = 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
  const models = 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'
  const configured = 'if (configured.welcomeNotice && !("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding"'

  it.each([
    ['任务已因退出 DeepSeek 登录而停止。', '任务已因退出模型服务账号登录而停止。'],
    ['请先登录 DeepSeek，并确认请求地址支持账号认证。', '请先登录模型服务账号，并确认请求地址支持账号认证。'],
    ['Stopped because you signed out of DeepSeek.', 'Stopped because you signed out of your model provider account.'],
    ['Sign in to DeepSeek and ensure the request destination supports account authentication.',
      'Sign in to your model provider and ensure the request destination supports account authentication.']
  ])('rebases reviewed chat locale copy: %s', (before, after) => {
    const context = ` "message.failure.accountSignedOut": "${before}",`
    expect(adaptBrandContext(context, chat, '')).toBe(context.replace(before, after))
    // Keep additions, removals and other fields exact: this adapter owns only existing account copy.
    const businessChange = `-"message.failure.accountSignedOut": "${before}",\n+doSomethingElse();`
    expect(adaptBrandContext(businessChange, chat, '')).toBe(businessChange)
  })

  it('retains neutral welcome and provider copy without changing the new onboarding flow', () => {
    const patch = [
      ' welcomeBody: "DeepSeek Harness DSH plugin ecosystem / DSH 插件生态",',
      '-onboardingDescription: "Configure the official DeepSeek provider to start building.",',
      '-onboardingDescription: "配置 DeepSeek 官方模型，即可开始使用。",',
      '+onboardingDescription: "Choose a provider. DSH will enable its models."'
    ].join('\n')
    expect(adaptBrandContext(patch, models, configured)).toBe([
      ' welcomeBody: "APUS Reflex APUS Reflex plugin ecosystem / APUS Reflex 插件生态",',
      '-onboardingDescription: "Connect DeepSeek with an API Key here, or skip this step and configure another provider in Settings → Models.",',
      '-onboardingDescription: "在此填写 API Key 连接 DeepSeek；也可跳过，在设置 → 模型中配置其他提供方。",',
      '+onboardingDescription: "Choose a provider. APUS Reflex will enable its models."'
    ].join('\n'))
  })

  it('does not infer replacements for unreviewed locale or business changes', () => {
    const changed = ' "message.failure.accountSignedOut": "A different account failure",\n existingBusinessRule();'
    expect(adaptBrandContext(changed, chat, '')).toBe(changed)
  })
})


it('matches the actual shared model form descriptions used as patch preimages', () => {
  const target = 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'
  const configured = 'if (configured.welcomeNotice && !("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding"'
  for (const [before, actual] of [
    ['Configure the official DeepSeek provider to start building.', en.onboardingDescription],
    ['配置 DeepSeek 官方模型，即可开始使用。', zh.onboardingDescription]
  ]) {
    expect(adaptBrandContext(`-onboardingDescription: ${JSON.stringify(before)},`, target, configured))
      .toBe(`-onboardingDescription: ${JSON.stringify(actual)},`)
  }
  expect(adaptBrandContext('+onboardingDescription: "APUS Reflex Harness will enable models"', target, configured))
    .toBe('+onboardingDescription: "APUS Reflex will enable models"')
})
