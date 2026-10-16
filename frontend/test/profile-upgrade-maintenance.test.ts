import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundlePatchFiles,
  composeEntries,
  loadProfileDirectory,
  PROFILE_TEMPLATES
} from '@deepseek-ai/dsh-app-boot'
import { IN_BOX_BUNDLES } from '../packages/dsh-desktop-market-installer/generations/projection'
import {
  KEEP_IN_SHARED_TREE,
  migrateProfileToGenerations,
  recoverInterruptedMigration
} from '../src/main/state/generation-migration'
import { prepareGenerationsForLaunch } from '../src/main/state/generation-launch'
import { runProfileStartupMaintenance } from '../src/main/state/profile-startup-maintenance'
import { projectRoot } from './patch-path'

/** Workspace sources of the shipped in-box bundles, whose real patches a launch composes. */
const BUNDLE_SOURCES: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-base': 'packages/bundle/base',
  '@deepseek-ai/dsh-web-app': 'packages/bundle/web-app',
  '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin': 'packages/experimental/apus-dsh-jev-plugin',
  '@deepseek-ai/dsh-experimental-system3': 'packages/experimental/system3',
  '@deepseek-ai/dsh-experimental-continuum-jev': 'packages/experimental/continuum-jev',
  '@deepseek-ai/dsh-experimental-reflex-local-bundle': 'packages/experimental/reflex-local-bundle'
}

const JEV = '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
const SYSTEM3 = '@deepseek-ai/dsh-experimental-system3'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

/**
 * An installation anchor holding each in-box bundle's manifest identity and real patch files, as the packaged
 * runtime's node_modules does; a profile never holds them itself.
 */
async function installation(home: string): Promise<string> {
  const app = join(home, 'app')
  await mkdir(app, { recursive: true })
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'apus-upgrade-fixture', private: true }))
  for (const [name, source] of Object.entries(BUNDLE_SOURCES)) {
    const from = join(projectRoot, '..', source)
    const manifest = JSON.parse(await readFile(join(from, 'package.json'), 'utf8'))
    const to = join(app, 'node_modules', name)
    await mkdir(to, { recursive: true })
    await writeFile(join(to, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, dsh: manifest.dsh }))
    for (const file of bundlePatchFiles(manifest.dsh.bundle)) {
      await mkdir(dirname(join(to, file)), { recursive: true })
      await copyFile(join(from, file), join(to, file))
    }
  }
  return join(app, 'package.json')
}

/** Run the launch's startup maintenance with the real migration and bundle preparation; other mutators are inert. */
async function launch(home: string, notes: string[]) {
  const note = (line: string): void => { notes.push(line) }
  return runProfileStartupMaintenance({
    note,
    recoverInterruptedMigration: () => recoverInterruptedMigration(home, note),
    incompletePluginRestoreId: async () => undefined,
    preparePackageStore: async () => undefined,
    demoteMarketGeneration: async () => false,
    enforcePendingPluginRemovals: async () => undefined,
    prepareGenerationsForLaunch: () => prepareGenerationsForLaunch(home, note),
    shouldDeferProfileMaintenance: async () => false,
    migrateProfileToGenerations: () => migrateProfileToGenerations({
      dshHome: home,
      nodeExecutablePath: process.execPath,
      pnpmEntryPath: 'pnpm',
      dshEntryPath: 'bin.js',
      note,
      reinstallSharedTree: async () => ({ ok: false, detail: 'a profile without community plugins never rebuilds the shared tree' })
    }),
    ensureMarketBaseline: async () => undefined,
    marketUsableWithoutBaseline: async () => true,
    reportProfileConsistency: async () => undefined,
    inspectProfileBootInputs: async () => undefined,
    pruneUnresolvableBundles: async () => []
  })
}

async function bundlesOf(home: string): Promise<string[]> {
  return JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')).dsh.profile.bundles
}

describe('upgrading a 0.1.3 profile', () => {
  it('composes exactly one System3 entry after two launches without freezing profile maintenance', async () => {
    const home = await mkdtemp(join(tmpdir(), 'apus-upgrade-'))
    homes.push(home)
    const profile = join(home, 'profiles', 'web')
    await mkdir(join(profile, 'node_modules'), { recursive: true })
    // The 0.1.3 profile: in-box Reflex bundles without System3, no community plugins, and the deferral it recorded.
    const earlier = IN_BOX_BUNDLES.filter((name) => name !== SYSTEM3)
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: earlier } }
    }))
    await writeFile(join(profile, '.generations-deferred.json'), JSON.stringify({
      protocol: 6,
      fingerprint: '3a51b1ea5c42d993f2d0fa1912aaad64342d0d0aa5e6e29a24adb24297e90bff',
      reason: `${JEV} has no readable installed package manifest`,
      failedAt: new Date().toISOString(),
      retryAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }))
    const anchor = await installation(home)

    const notes: string[] = []
    const first = await launch(home, notes)
    expect(first).toMatchObject({ outcome: 'normal-profile', migration: { outcome: 'no-op' } })
    const upgraded = await bundlesOf(home)
    expect(upgraded.filter((name) => name === SYSTEM3)).toHaveLength(1)
    expect(upgraded.indexOf(SYSTEM3)).toBeGreaterThan(upgraded.indexOf(JEV))

    const second = await launch(home, notes)
    expect(second).toMatchObject({ outcome: 'normal-profile', migration: { outcome: 'no-op' } })
    expect(await bundlesOf(home)).toEqual(upgraded)
    expect(notes.filter((line) => /frozen|deferred/u.test(line))).toEqual([])

    const loaded = loadProfileDirectory('dsh-desktop', profile, anchor)
    expect(loaded.skippedBundles).toEqual([])
    const entries = composeEntries([...loaded.layers.map((layer) => layer.patches), loaded.patches])
    expect(entries.filter((entry) => entry.id === 'system3')).toHaveLength(1)
    expect(entries.filter((entry) => entry.id === 'jev')).toHaveLength(1)
  })
})

describe('in-box bundle lists', () => {
  it('derive every startup list from IN_BOX_BUNDLES', async () => {
    const template = PROFILE_TEMPLATES.web
    if (template === undefined) throw new Error('Missing web profile template')
    // The template's bundles open the in-box list, so a fresh profile composes exactly the in-box bundles in order.
    expect(IN_BOX_BUNDLES.slice(0, template.bundles.length)).toEqual(template.bundles)
    expect(IN_BOX_BUNDLES.indexOf(SYSTEM3)).toBeGreaterThan(IN_BOX_BUNDLES.indexOf(JEV))
    expect(IN_BOX_BUNDLES.indexOf('@deepseek-ai/dsh-experimental-reflex-local-bundle')).toBeGreaterThan(IN_BOX_BUNDLES.indexOf(JEV))
    // Migration keeps every in-box bundle in the shared tree.
    expect(IN_BOX_BUNDLES.filter((name) => !KEEP_IN_SHARED_TREE.has(name))).toEqual([])
    expect([...KEEP_IN_SHARED_TREE].filter((name) => !IN_BOX_BUNDLES.includes(name))).toEqual(['dshmarket'])
    // Launch preparation appends exactly the in-box bundles a profile lacks.
    const home = await mkdtemp(join(tmpdir(), 'apus-in-box-'))
    homes.push(home)
    await prepareGenerationsForLaunch(home, () => undefined)
    expect(await bundlesOf(home)).toEqual(IN_BOX_BUNDLES)
    // Each in-box bundle has a workspace source that declares a bundle patch.
    expect(Object.keys(BUNDLE_SOURCES)).toEqual([...IN_BOX_BUNDLES])
    for (const source of Object.values(BUNDLE_SOURCES)) {
      expect(existsSync(join(projectRoot, '..', source, 'package.json'))).toBe(true)
    }
  })
})
