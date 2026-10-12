import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHiddenConsole } from '../build/windows-hidden-console.mjs'

describe('createHiddenConsole', () => {
  it.each(['available', 'missing', 'broken'] as const)(
    'loads from an isolated packaged layout with %s native dependency', (dependency) => {
      const root = mkdtempSync(join(tmpdir(), 'DSH packaged console '))
      try {
        const resources = join(root, 'resources')
        const app = join(resources, 'app')
        mkdirSync(app, { recursive: true })
        writeFileSync(join(app, 'package.json'), '{}')
        const helper = join(resources, 'windows-hidden-console.mjs')
        copyFileSync('build/windows-hidden-console.mjs', helper)
        if (dependency !== 'missing') {
          const pkg = join(app, 'node_modules', 'koffi')
          mkdirSync(pkg, { recursive: true })
          writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'koffi', main: 'index.cjs' }))
          writeFileSync(join(pkg, 'index.cjs'), dependency === 'broken'
            ? "throw new Error('Native binding unavailable')"
            : `exports.load = () => ({ func: name => {
                if (name === 'AllocConsole') return () => true;
                if (name === 'GetConsoleWindow') return () => 123;
                return (window, command) => { if (window !== 123 || command !== 0) throw new Error('Invalid hide call'); };
              } });`)
        }
        const output = execFileSync(process.execPath, ['--input-type=module', '-e',
          `const { createHiddenConsole } = await import(${JSON.stringify(pathToFileURL(helper).href)});
           console.log(JSON.stringify({ hidden: createHiddenConsole(), startupContinued: true }));`
        ], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' }, timeout: 10000 })
        expect(JSON.parse(output)).toEqual({ hidden: dependency === 'available', startupContinued: true })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it('allocates a console and hides it with SW_HIDE', () => {
    const allocConsole = vi.fn(() => true)
    const getConsoleWindow = vi.fn(() => 123n)
    const showWindow = vi.fn(() => true)

    const load = vi.fn((name: string) => {
      if (name === 'kernel32.dll') {
        return {
          func: vi.fn((fn: string) =>
            fn === 'AllocConsole' ? allocConsole : getConsoleWindow
          )
        }
      }
      if (name === 'user32.dll') {
        return { func: vi.fn(() => showWindow) }
      }
      throw new Error(`unexpected library ${name}`)
    })

    expect(createHiddenConsole({ load })).toBe(true)
    expect(allocConsole).toHaveBeenCalledOnce()
    expect(showWindow).toHaveBeenCalledWith(123n, 0)
  })

  it('returns false without hiding when AllocConsole fails', () => {
    const allocConsole = vi.fn(() => false)
    const showWindow = vi.fn()
    const load = vi.fn((name: string) => {
      if (name === 'kernel32.dll') {
        return {
          func: vi.fn((fn: string) => (fn === 'AllocConsole' ? allocConsole : vi.fn(() => 0n)))
        }
      }
      return { func: vi.fn(() => showWindow) }
    })

    expect(createHiddenConsole({ load })).toBe(false)
    expect(showWindow).not.toHaveBeenCalled()
  })

  it('skips ShowWindow when GetConsoleWindow returns a null window', () => {
    const allocConsole = vi.fn(() => true)
    const showWindow = vi.fn()
    const load = vi.fn((name: string) => {
      if (name === 'kernel32.dll') {
        return {
          func: vi.fn((fn: string) => (fn === 'AllocConsole' ? allocConsole : vi.fn(() => null)))
        }
      }
      return { func: vi.fn(() => showWindow) }
    })

    expect(createHiddenConsole({ load })).toBe(true)
    expect(showWindow).not.toHaveBeenCalled()
  })

  it('swallows loader errors and returns false', () => {
    const load = vi.fn(() => {
      throw new Error('win32 unavailable')
    })
    expect(createHiddenConsole({ load })).toBe(false)
  })
})
