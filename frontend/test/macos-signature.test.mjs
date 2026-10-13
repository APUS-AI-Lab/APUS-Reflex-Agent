import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import signature from '../scripts/verify-macos-signature.cjs'

const require = createRequire(import.meta.url)
const { MacTargetHelper } = require('app-builder-lib/out/mac/MacTargetHelper.js')
const { signAsync } = require('@electron/osx-sign')
const build = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build
const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function copiedBinary(source, target) {
  mkdirSync(join(target, '..'), { recursive: true })
  copyFileSync(source, target, constants.COPYFILE_FICLONE)
}

describe.skipIf(process.platform !== 'darwin')('macOS preview application sealing', () => {
  it('signs native children through the pinned builder options and rejects modified resources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'apus-mac-seal-'))
    roots.push(root)
    const app = join(root, 'APUSFixture.app')
    const contents = join(app, 'Contents')
    const resources = join(contents, 'Resources')
    mkdirSync(resources, { recursive: true })
    copiedBinary('/bin/echo', join(contents, 'MacOS/APUSFixture'))
    const node = join(resources, 'node/bin/node')
    copiedBinary(fileURLToPath(new URL('../node_modules/node/bin/node', import.meta.url)), node)
    copiedBinary(fileURLToPath(new URL(`../node_modules/node-pty/prebuilds/darwin-${process.arch}/pty.node`, import.meta.url)), join(resources, 'pty.node'))
    const office = fileURLToPath(new URL(`../node_modules/@deepseek-ai/libreoffice-kit-darwin-${process.arch}/bin/libreoffice-kit`, import.meta.url))
    expect(existsSync(office)).toBe(true)
    copiedBinary(office, join(resources, 'office/bin/libreoffice-kit'))
    writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.apus.reflex.seal.fixture</string><key>CFBundleExecutable</key><string>APUSFixture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>0.1.1</string></dict></plist>\n`)
    const resource = join(resources, 'edition.txt')
    writeFileSync(resource, 'full\n')
    await expect(signature.verifyMacBundle(app, { adHoc: true })).rejects.toThrow()
    vi.stubEnv('CSC_IDENTITY_AUTO_DISCOVERY', 'false')
    const helper = new MacTargetHelper({ forceCodeSigning: false, platformSpecificBuildOptions: build.mac, config: { electronVersion: '43.0.0' }, resourceList: Promise.resolve([]), info: { buildResourcesDir: fileURLToPath(new URL('../build', import.meta.url)) } })
    const identity = await helper.findSigningIdentity(false, false, '-', undefined, build.mac)
    expect(identity.name).toBe('-')
    const options = await helper.buildSignOptions(app, identity, 'distribution', false, build.mac, undefined, process.arch === 'arm64' ? 3 : 1)
    await signAsync(options)
    await expect(signature.verifyMacBundle(app, { adHoc: true })).resolves.toEqual({ valid: true, adHoc: true, resourceSeal: true })
    const entitlements = execFileSync('/usr/bin/codesign', ['--display', '--entitlements', ':-', node], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).toContain('com.apple.security.cs.disable-library-validation')
    expect(execFileSync(node, ['-p', '1 + 1'], { encoding: 'utf8' }).trim()).toBe('2')
    writeFileSync(resource, 'lite\n')
    await expect(signature.verifyMacBundle(app, { adHoc: true })).rejects.toThrow()
  }, 60_000)
})

it('skips macOS signature commands for a Windows packaging hook', async () => {
  await expect(signature({ electronPlatformName: 'win32' })).resolves.toBeUndefined()
})
