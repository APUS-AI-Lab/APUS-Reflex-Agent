/** Resolve only the explicitly prepared APUS Harness runtime. */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const SYSTEM3_RUNTIME_VERSION = '0.1.7-rc.2'

/** The physical runtime selected by the Desktop build manifest. */
export interface System3Runtime {
  readonly root: string
  readonly entry: string
  readonly version: string
  readonly mode: 'workspace' | 'deployed'
  readonly sourceRevision: string
  readonly edition: 'full' | 'lite'
  /** Final application overlay; absent only for legacy Full runtime manifests. */
  readonly editionPatchPath?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contained(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error('APUS Reflex Harness runtime paths must be relative')
  const candidate = realpathSync(resolve(root, path))
  const rel = relative(realpathSync(root), candidate)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('APUS Reflex Harness runtime file escapes its prepared root')
  }
  return candidate
}

/**
 * Validate the generated file/process boundary before launching any dsh profile.
 * @param appPath - Electron's application directory in development.
 * @param resourcesPath - Electron's packaged resource directory.
 * @param isPackaged - Packaged apps reject checkout manifests.
 * @returns The pinned runtime and final edition overlay; legacy manifests use Full.
 * @throws When the manifest, package identities, or declared edition policy are invalid.
 */
export function resolveSystem3Runtime(appPath: string, resourcesPath: string, isPackaged: boolean): System3Runtime {
  const artifactRoot = isPackaged ? join(resourcesPath, 'system3-runtime') : join(appPath, '.build', 'system3-runtime')
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(artifactRoot, 'runtime-manifest.json'), 'utf8'))
  } catch (error) {
    throw new Error('APUS Reflex Harness runtime is missing. Run runtime:prepare with the own rc.2 Harness source.', { cause: error })
  }
  if (!record(manifest) || manifest.formatVersion !== 1 || manifest.product !== 'xdan-system3' ||
      manifest.version !== SYSTEM3_RUNTIME_VERSION || (manifest.mode !== 'workspace' && manifest.mode !== 'deployed') ||
      typeof manifest.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.sourceRevision) ||
      typeof manifest.entry !== 'string' || !Array.isArray(manifest.packages) ||
      (manifest.edition !== undefined && manifest.edition !== 'full' && manifest.edition !== 'lite') ||
      (manifest.edition === undefined && manifest.editionPatch !== undefined) ||
      (manifest.edition !== undefined && manifest.editionPatch !== 'product-edition.patch.yml')) {
    throw new Error('APUS Reflex Harness runtime manifest is incompatible; own 0.1.7-rc.2 is required')
  }
  const edition = manifest.edition ?? 'full'
  let editionPatchPath: string | undefined
  if (manifest.edition !== undefined) {
    try {
      editionPatchPath = contained(artifactRoot, 'product-edition.patch.yml')
      if (!statSync(editionPatchPath).isFile()) throw new Error('Expected an edition patch file')
    } catch (cause) {
      throw new Error(`APUS Reflex Agent ${edition} edition policy is missing or invalid`, { cause })
    }
  }
  if (isPackaged && (manifest.platform !== process.platform || manifest.arch !== process.arch)) throw new Error('APUS Reflex Harness runtime target does not match this host')
  if (isPackaged && manifest.mode !== 'deployed') throw new Error('Packaged APUS Reflex Harness cannot launch a source checkout')
  const root = manifest.mode === 'workspace'
    ? (typeof manifest.sourceRoot === 'string' && isAbsolute(manifest.sourceRoot) ? manifest.sourceRoot : '')
    : artifactRoot
  if (!root) throw new Error('APUS Reflex Harness workspace manifest has no explicit source root')
  const required = new Set(['@deepseek-ai/dsh', '@deepseek-ai/dsh-experimental-system3', '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', '@deepseek-ai/dsh-experimental-system3-policy', '@deepseek-ai/dsh-experimental-system3-evidence', '@deepseek-ai/dsh-experimental-system3-supervisor', '@deepseek-ai/dsh-experimental-client-ui-system3'])
  if (manifest.edition !== undefined) {
    required.add('@deepseek-ai/dsh-continuum')
    required.add('@deepseek-ai/dsh-experimental-continuum-jev')
  }
  for (const item of manifest.packages) {
    if (!record(item) || typeof item.name !== 'string' || typeof item.path !== 'string') throw new Error('Invalid APUS Reflex Harness package identity')
    const pkg: unknown = JSON.parse(readFileSync(contained(root, item.path), 'utf8'))
    if (!record(pkg) || pkg.name !== item.name || pkg.version !== SYSTEM3_RUNTIME_VERSION) {
      throw new Error(`APUS Reflex Harness package ${item.name} must come from the own rc.2 build`)
    }
    required.delete(item.name)
  }
  if (required.size) throw new Error(`APUS Reflex Harness runtime is incomplete: ${[...required].join(', ')}`)
  return { root: realpathSync(root), entry: contained(root, manifest.entry), version: SYSTEM3_RUNTIME_VERSION, mode: manifest.mode, sourceRevision: manifest.sourceRevision, edition, editionPatchPath }
}
