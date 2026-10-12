import { describe, expect, it } from 'vitest'
import { resolveHarnessLocale } from '../src/main/application-locale'

describe('application locale', () => {
  it('uses the saved DSH preference when one exists', () => {
    expect(resolveHarnessLocale('en', ['zh-Hans-CN'])).toBe('en')
    expect(resolveHarnessLocale('zh', ['en-US'])).toBe('zh')
  })

  it('defaults the first launch from the preferred system language', () => {
    expect(resolveHarnessLocale(undefined, ['zh-Hans-CN', 'en-US'])).toBe('zh')
    expect(resolveHarnessLocale(undefined, ['zh-Hant-TW', 'en-US'])).toBe('zh')
    expect(resolveHarnessLocale(undefined, ['en-US', 'zh-Hans-CN'])).toBe('en')
    expect(resolveHarnessLocale(undefined, [])).toBe('en')
  })

  it('falls back to the system language when the saved preference is invalid', () => {
    expect(resolveHarnessLocale('auto', ['zh-CN'])).toBe('zh')
    expect(resolveHarnessLocale({ value: 'zh' }, ['en-US'])).toBe('en')
  })
})
