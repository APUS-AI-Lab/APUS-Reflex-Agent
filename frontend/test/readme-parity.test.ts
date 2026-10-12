import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readmes = [
  'README.md',
  'README.zh.md',
  'README.ja.md',
  'README.ru.md',
  'README.es.md',
  'README.pt.md'
]

const productRepository = 'https://github.com/APUS-AI-Lab/APUS-Reflex-Harness'
const productGuides = ['installation', 'configuration', 'development', 'releases']

describe('localized README parity', () => {
  for (const path of readmes) {
    it(`${path} carries the current product facts`, () => {
      const content = readFileSync(path, 'utf8')

      const targets = Array.from(content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g), match => match[1]?.replace(/\.zh\.md$/, '.md'))
      expect(content).toContain('Model-as-a-Harness')
      expect(targets).toContain('../README.md')
      expect(targets).toContain(`${productRepository}/releases`)
      expect(targets).toContain('LICENSE')
      expect(targets).toContain('THIRD_PARTY_NOTICES.md')
      for (const guide of productGuides) {
        expect(targets).toContain(`../docs/feat-integrated-product/${guide}.md`)
      }
      expect(content).not.toContain('APUS-Reflex-Frontend.git')
      expect(content).not.toContain('Model as Harness')
      expect(content).not.toContain('https://github.com/dataelement/dsh-desktop/releases')
      expect(content).not.toMatch(/https:\/\/(?:www\.)?dshdesktop\.com\/(?:#download|zh\/)/)
      expect(content).not.toContain('@deepseek-ai/dsh@0.1.1-rc.1')
      expect(content).not.toMatch(/NSIS\s*(?:and|与|と|и|y|e)\s*Portable/i)
    })
  }

  it('keeps every relative Markdown link resolvable', () => {
    const documents = [
      ...readmes,
      '../README.md',
      '../README.zh.md',
      ...productGuides.flatMap(guide => [
        `../docs/feat-integrated-product/${guide}.md`,
        `../docs/feat-integrated-product/${guide}.zh.md`
      ]),
      'docs/development.md',
      'docs/architecture.md',
      'docs/release-runbook.md',
      'docs/preset-packages.md'
    ]

    for (const path of documents) {
      const content = readFileSync(path, 'utf8')
      const links = content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)

      for (const match of links) {
        const target = match[1]
        if (!target) continue
        if (/^(?:https?:|mailto:)/.test(target)) continue
        const withoutAnchor = target.split('#', 1)[0]
        if (!withoutAnchor) continue
        expect(
          existsSync(resolve(dirname(path), decodeURIComponent(withoutAnchor))),
          `${path} links to missing ${target}`
        ).toBe(true)
      }
    }
  })

  it('does not publish internal working documents', () => {
    expect(existsSync('docs/preset-square-mvp.md')).toBe(false)
    expect(existsSync('docs/windows-profile-repair.md')).toBe(false)
  })
})
