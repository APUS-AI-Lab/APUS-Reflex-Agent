/** Responsive settings rules preserve independent navigation and content scrolling. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')
it('gives narrow settings full-width content while keeping every section reachable', () => {
  const narrow = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1]
  expect(narrow).toBeDefined()
  expect(narrow).toMatch(/\.panel\s*\{[^}]*flex-direction: column/)
  expect(narrow).toMatch(/\.nav\s*\{[^}]*width: 100%/)
  expect(narrow).toMatch(/\.navList\s*\{[^}]*overflow-x: auto/)
  expect(narrow).toMatch(/\.navCell\s*\{[^}]*flex: none/)
  expect(narrow).toMatch(/\.content\s*\{[^}]*min-height: 0/)
  expect(css).toMatch(/\.options\s*\{[^}]*overflow-y: auto/)
})
