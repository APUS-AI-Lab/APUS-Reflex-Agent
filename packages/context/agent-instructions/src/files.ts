/**
 * Instruction-file discovery and bounded, abort-aware provider reads.
 *
 * @module @deepseek-ai/dsh-agent-instructions/files
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { FsVersion, type FileSystem, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { dshHomeDisplay } from '@deepseek-ai/dsh-home-paths'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { resolveConfig, resolveDiscoveryConfig, type ResolvedConfig } from './config.ts'
import { trimmedInstructionDigest } from './digest.ts'
import {
  decodeScopeKey,
  renderAgentInstructionSet,
  type RenderedAgentInstructions,
  USER_GLOBAL_DIRECTORY,
  USER_GLOBAL_FILE,
} from './render.ts'

/** An instruction candidate identified by absolute and model-facing paths. */
export interface InstructionFile {
  absolutePath: string
  displayPath: string
}

/** An instruction file whose UTF-8 content was read successfully. */
export interface LoadedInstructionFile extends InstructionFile {
  content: string
  /** Provider freshness token when the file was loaded through `ctx.fs`. */
  version?: FsVersion
}

interface DiscoveredInstructionFile extends InstructionFile {
  target?: FsTarget
  size?: number
  version?: FsVersion
}

/** Provider metadata for a probed scope candidate before its content is read. */
export interface ProbedInstructionFile extends InstructionFile {
  /** Resolved provider target; absent for a fixed Host rule read by this process. */
  target?: FsTarget
  version: FsVersion
  size?: number
}

/** Display namespace for files loaded from a fixed Host rule root. */
export const HOST_RULE_DIRECTORY_PREFIX = 'host-rules'

interface DiscoverOptions {
  cwd: string
  dshHome?: string
  projectRootMarkers?: string[]
  instructionFileCandidates?: string[]
  localInstructionFileCandidates?: string[]
  hostInstructionRoots?: string[]
  projectRoot?: string
  signal?: AbortSignal
  /**
   * Opaque identity of the agent the load acts for. A provider whose execution
   * world is another container (the benchmark task environment) needs it to
   * choose that world; a Host-local provider ignores it.
   */
  agentId?: string
}

interface LoadOptions extends DiscoverOptions {
  maxBytes: number
  maxSourceBytes?: number
  replacePreviousBaseline?: boolean
}

/** Rendered baseline plus the successfully read and byte-budget-retained files. */
export interface RenderedInstructionSet {
  rendered: RenderedAgentInstructions
  /** Successfully read candidates before content deduplication and byte budgeting. */
  observed: LoadedInstructionFile[]
  /** Candidates retained by content deduplication and byte budgeting. */
  included: LoadedInstructionFile[]
}
/** Tri-state scope probe that distinguishes confirmed absence from provider failure. */
export type ScopeInstructionProbe =
  | { kind: 'present'; file: ProbedInstructionFile }
  | { kind: 'absent' }
  | { kind: 'unavailable' }

interface StatFileInfo {
  target?: FsTarget
  size?: number
  version?: FsVersion
}

type StatFileProbe =
  | { kind: 'present'; info: StatFileInfo }
  | { kind: 'absent' }
  | { kind: 'unavailable' }

/**
 * Provider resolution options carrying the agent whose world the path lives in.
 * @param agentId - agent the read acts for, when the caller knows one.
 * @param signal - cancellation for the provider round-trip.
 * @returns options for `FileSystem.resolve`, or undefined when neither applies.
 */
function resolutionOptions(
  agentId: string | undefined,
  signal?: AbortSignal,
): { agentId?: string; signal?: AbortSignal } | undefined {
  if (agentId === undefined && signal === undefined) return undefined
  return {
    ...agentId === undefined ? {} : { agentId },
    ...signal === undefined ? {} : { signal },
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function isMissingProviderPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'FS_NOT_FOUND'
}

async function nodeStatFile(path: string, signal?: AbortSignal): Promise<StatFileProbe> {
  try {
    signal?.throwIfAborted()
    // stat (not lstat) follows a final-component symlink so a link to a regular
    // file loads; a broken link surfaces as ENOENT and is treated as absent below.
    const info = await stat(path)
    signal?.throwIfAborted()
    if (!info.isFile()) return { kind: 'absent' }
    // A version-token pair (mtime and size) so a Host-rule reconciliation can
    // skip an unchanged file yet never reuse a same-size earlier revision.
    return { kind: 'present', info: { size: info.size, version: FsVersion(`host:${info.mtimeMs}:${info.size}`) } }
  } catch (error: unknown) {
    signal?.throwIfAborted()
    return isMissingPathError(error) ? { kind: 'absent' } : { kind: 'unavailable' }
  }
}

async function fsStatFile(
  path: string,
  fileSystem: FileSystem,
  agentId: string | undefined,
  signal?: AbortSignal,
): Promise<StatFileProbe> {
  // resolve() follows a final-component symlink to its target's stable identity;
  // stat then classifies that target. A link to a regular file loads, while a
  // missing path or non-file target (including a link to a directory) is absent.
  try {
    const target = await fileSystem.resolve(path, resolutionOptions(agentId, signal))
    signal?.throwIfAborted()
    const info = await fileSystem.stat(target, signal)
    signal?.throwIfAborted()
    if (info?.type !== 'file') return { kind: 'absent' }
    return {
      kind: 'present',
      info: { target, version: info.version, ...info.size === undefined ? {} : { size: info.size } },
    }
  } catch {
    signal?.throwIfAborted()
    return { kind: 'unavailable' }
  }
}

async function statFile(
  path: string,
  fileSystem: FileSystem | undefined,
  agentId: string | undefined,
  signal?: AbortSignal,
): Promise<StatFileProbe> {
  return fileSystem === undefined ? nodeStatFile(path, signal) : fsStatFile(path, fileSystem, agentId, signal)
}

async function existsAsMarker(
  path: string,
  fileSystem: FileSystem | undefined,
  agentId: string | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  if (fileSystem !== undefined) {
    try {
      const target = await fileSystem.resolve(path, resolutionOptions(agentId, signal))
      return await fileSystem.stat(target, signal) !== undefined
    } catch (error: unknown) {
      signal?.throwIfAborted()
      if (isMissingProviderPathError(error)) return false
      throw error
    }
  }
  try {
    signal?.throwIfAborted()
    await stat(path)
    signal?.throwIfAborted()
    return true
  } catch (error: unknown) {
    signal?.throwIfAborted()
    if (isMissingPathError(error)) return false
    throw error
  }
}

/**
 * Walk upward to the first directory containing a configured root marker.
 * @param cwd - absolute session working directory where the walk begins.
 * @param markers - child names that identify a project root.
 * @param fileSystem - optional provider used instead of host filesystem probes.
 * @param signal - cancellation for provider and host probes.
 * @param agentId - agent whose execution world the walk belongs to.
 * @returns the discovered project root, or `cwd` when no marker exists.
 * @throws the original marker metadata error or cancellation reason when a probe is unavailable.
 */
export async function findProjectRoot(
  cwd: string,
  markers: readonly string[],
  fileSystem?: FileSystem,
  signal?: AbortSignal,
  agentId?: string,
): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      if (await existsAsMarker(join(current, marker), fileSystem, agentId, signal)) return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * Build the inclusive root-to-cwd directory chain.
 * @param root - root directory expected to contain or equal `cwd`.
 * @param cwd - most-specific directory in the chain.
 * @returns directories ordered from broadest to most specific.
 */
export function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  const resolvedRoot = resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    /* v8 ignore next -- discovery always supplies cwd or an ancestor root. */
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * Find descendant directories crossed between a cwd and a touched file.
 * @param root - session cwd that bounds nested discovery.
 * @param touchedPath - absolute path or path relative to `root`.
 * @returns descendant directories from shallowest through the touched file's parent.
 */
export function descendantDirsBetween(root: string, touchedPath: string): string[] {
  const resolvedRoot = resolve(root)
  const targetPath = isAbsolute(touchedPath) ? resolve(touchedPath) : resolve(resolvedRoot, touchedPath)
  const targetDir = dirname(targetPath)
  const rel = relative(resolvedRoot, targetDir)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return []
  return ancestorChain(resolvedRoot, targetDir).slice(1)
}

/**
 * Convert an absolute instruction path to its project-root-relative display form.
 * @param root - project root used as the display base.
 * @param path - absolute path to display.
 * @returns the root-relative path.
 */
export function relativeDisplay(root: string, path: string): string {
  return relative(root, path)
}

async function allExistingInstructionFiles(
  dir: string,
  root: string,
  instructionFileCandidates: readonly string[],
  fileSystem: FileSystem | undefined,
  agentId: string | undefined,
  signal?: AbortSignal,
): Promise<DiscoveredInstructionFile[]> {
  const found: DiscoveredInstructionFile[] = []
  for (const candidate of instructionFileCandidates) {
    const path = join(dir, candidate)
    const probe = await statFile(path, fileSystem, agentId, signal)
    switch (probe.kind) {
      case 'present':
        found.push({ absolutePath: path, displayPath: relativeDisplay(root, path), ...probe.info })
        continue
      // A missing candidate is skipped; a transient provider failure skips only
      // that candidate so the remaining independent candidates still load.
      case 'absent':
      case 'unavailable':
        continue
      /* v8 ignore next 2 -- StatFileProbe is closed; this arm only makes adding a kind a compile error. */
      default:
        assertNever(probe, 'StatFileProbe')
    }
  }
  return found
}

async function discoverInstructionFiles(
  options: DiscoverOptions,
  fileSystem?: FileSystem,
): Promise<DiscoveredInstructionFile[]> {
  const config = resolveDiscoveryConfig(options)
  const files: DiscoveredInstructionFile[] = []
  const seen = new Set<string>()
  const addFile = (file: DiscoveredInstructionFile): void => {
    if (seen.has(file.absolutePath)) return
    seen.add(file.absolutePath)
    files.push(file)
  }

  // The user-global rule is a fixed read-only Host resource of this loader: it
  // belongs to the harness installation, not to the agent's task container.
  // A provider that can read Host paths keeps serving it (its reads are what
  // the product records); a task-container provider cannot, and asking it needs
  // an agent id this file does not have — it would reject the whole turn.
  const userGlobal = join(config.dshHome, USER_GLOBAL_FILE)
  const userGlobalLocal = fileSystem === undefined
    || fileSystem.processPathFromHostPath(userGlobal) === undefined
  const userGlobalProbe = userGlobalLocal
    ? await nodeStatFile(userGlobal, options.signal)
    : await statFile(userGlobal, fileSystem, undefined, options.signal)
  switch (userGlobalProbe.kind) {
    case 'present':
      addFile({
        absolutePath: userGlobal,
        displayPath: userGlobalDisplayPath(config.dshHome),
        ...userGlobalProbe.info,
      })
      break
    case 'absent':
    case 'unavailable':
      break
    /* v8 ignore next 2 -- StatFileProbe is closed; this arm only makes adding a kind a compile error. */
    default:
      assertNever(userGlobalProbe, 'StatFileProbe')
  }

  // Fixed Host rule roots are harness-installation resources too. Host file
  // location is only meaningful to this process, so they are always read from
  // the host filesystem and never through the agent's execution world.
  for (const root of config.hostInstructionRoots) {
    for (const candidates of [config.instructionFileCandidates, config.localInstructionFileCandidates]) {
      for (const file of await allExistingInstructionFiles(root, root, candidates, undefined, undefined, options.signal)) {
        addFile({ ...file, displayPath: hostRootDisplayPath(root, file.absolutePath) })
      }
    }
  }

  const cwd = resolve(options.cwd)
  const projectRoot = options.projectRoot
    ?? await findProjectRoot(cwd, config.projectRootMarkers, fileSystem, options.signal, options.agentId)
  for (const dir of ancestorChain(projectRoot, cwd)) {
    for (const candidates of [config.instructionFileCandidates, config.localInstructionFileCandidates]) {
      for (const file of await allExistingInstructionFiles(dir, projectRoot, candidates, fileSystem, options.agentId, options.signal)) {
        addFile(file)
      }
    }
  }
  return files
}

/**
 * Discover host-visible user-global and root-to-cwd instruction candidates.
 * All present candidates in each directory are returned; trimmed-content
 * duplicates are collapsed later, once content is read.
 * @param options - cwd, home, root marker, and candidate configuration.
 * @returns path-deduplicated instruction candidates in model precedence order.
 * @throws the original root-marker metadata error or cancellation reason when
 * discovery cannot identify the project root.
 */
export async function discoverBaselineInstructionFiles(options: DiscoverOptions): Promise<InstructionFile[]> {
  return (await discoverInstructionFiles(options)).map(({ absolutePath, displayPath }) => ({ absolutePath, displayPath }))
}

/**
 * Read one Host-resident instruction file under the source cap.
 * @param file - Host rule candidate and its metadata snapshot.
 * @param maxSourceBytes - maximum UTF-8 bytes accepted from the source.
 * @param signal - cancellation for the host stream.
 * @returns the decoded content, or undefined when unavailable or over budget.
 */
async function readBoundedHost(
  file: { absolutePath: string; size?: number },
  maxSourceBytes: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return await readBounded(file, maxSourceBytes, undefined, signal)
}

async function* nodeTextChunks(path: string, signal?: AbortSignal): AsyncIterable<string> {
  const stream = createReadStream(path, { encoding: 'utf8', signal })
  for await (const chunk of stream) yield String(chunk)
}

async function readBounded(
  file: { absolutePath: string; target?: FsTarget; size?: number },
  maxSourceBytes: number,
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<string | undefined> {
  // TODO(total-instruction-read-bound): enforce an aggregate source budget
  // across a complete baseline or reconciliation batch; the render budget is
  // applied only after every accepted file has been read under this per-file cap.
  signal?.throwIfAborted()
  if (file.size !== undefined && file.size > maxSourceBytes) return undefined
  try {
    const chunks = fileSystem === undefined || file.target === undefined
      ? nodeTextChunks(file.absolutePath, signal)
      : await fileSystem.streamText(file.target, signal)
    const parts: string[] = []
    let bytes = 0
    for await (const chunk of chunks) {
      signal?.throwIfAborted()
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > maxSourceBytes) return undefined
      parts.push(chunk)
    }
    signal?.throwIfAborted()
    return parts.join('')
  } catch {
    signal?.throwIfAborted()
    // A file may disappear or become unreadable after its metadata probe.
    return undefined
  }
}

/**
 * Drop later candidates whose trimmed content duplicates an earlier sibling in
 * the same directory. Different directories never collapse even when identical;
 * within one directory the earliest candidate in discovery order is kept and its
 * original bytes are rendered. A candidate that symlinks a sibling resolves to
 * the same content and collapses here like any byte-identical real file.
 * @param files - loaded files in discovery order.
 * @returns the retained files in the same order.
 */
export function dedupInstructionFilesByDirectory(files: LoadedInstructionFile[]): LoadedInstructionFile[] {
  const keptDigestsByDir = new Map<string, Set<string>>()
  const kept: LoadedInstructionFile[] = []
  for (const file of files) {
    const dir = dirname(file.displayPath)
    let digests = keptDigestsByDir.get(dir)
    if (digests === undefined) {
      digests = new Set()
      keptDigestsByDir.set(dir, digests)
    }
    const digest = trimmedInstructionDigest(file.content)
    if (digests.has(digest)) continue
    digests.add(digest)
    kept.push(file)
  }
  return kept
}

/**
 * Discover, read, and render the baseline instruction chain.
 * @param options - discovery, source-size, byte-budget, and cancellation configuration.
 * @param fileSystem - optional provider used instead of host filesystem reads.
 * @returns rendered baseline context, or undefined when nothing can be loaded.
 * @throws the original root-marker metadata error or cancellation reason when
 * discovery cannot identify the project root.
 */
export async function loadBaselineInstructions(
  options: LoadOptions,
  fileSystem?: FileSystem,
): Promise<RenderedAgentInstructions | undefined> {
  return (await loadBaselineInstructionSet(options, fileSystem))?.rendered
}

/**
 * Load a baseline together with the files retained after rendering.
 * @param options - discovery, source-size, byte-budget, and cancellation configuration.
 * @param fileSystem - optional provider used instead of host filesystem reads.
 * @returns rendered context and retained files, an explicit empty replacement set, or undefined when empty or disabled.
 */
export async function loadBaselineInstructionSet(
  options: LoadOptions,
  fileSystem?: FileSystem,
): Promise<RenderedInstructionSet | undefined> {
  const config = resolveConfig(options)
  if (config.maxBytes <= 0 || !Number.isFinite(config.maxBytes)) return undefined
  if (config.maxSourceBytes <= 0 || !Number.isFinite(config.maxSourceBytes)) return undefined
  const discovered = await discoverInstructionFiles(options, fileSystem)
  const loaded: LoadedInstructionFile[] = []
  for (const file of discovered) {
    const content = await readBounded(file, config.maxSourceBytes, fileSystem, options.signal)
    if (content !== undefined) {
      loaded.push({
        absolutePath: file.absolutePath,
        displayPath: file.displayPath,
        content,
        ...file.version === undefined ? {} : { version: file.version },
      })
    }
  }
  const deduped = dedupInstructionFilesByDirectory(loaded)
  if (deduped.length === 0) {
    if (options.replacePreviousBaseline !== true) return undefined
    const { rendered, included } = renderAgentInstructionSet([], {
      maxBytes: config.maxBytes,
      replacePreviousBaseline: true,
    })
    return {
      rendered,
      observed: [],
      included,
    }
  }
  const { rendered, included } = renderAgentInstructionSet(deduped, {
    maxBytes: config.maxBytes,
    ...options.replacePreviousBaseline === undefined
      ? {}
      : { replacePreviousBaseline: options.replacePreviousBaseline },
  })
  return {
    rendered,
    observed: loaded,
    included,
  }
}

/**
 * Probe the current provider metadata for one per-candidate instruction scope.
 * @param scope - a {@link candidateScopeKey} identifying a directory and candidate file.
 * @param projectRoot - project root used to resolve and display project scopes.
 * @param resolved - normalized plugin configuration.
 * @param fileSystem - provider used to resolve and stat scope candidates.
 * @param signal - cancellation for provider probes.
 * @param agentId - agent whose execution world owns the probed directory; the
 *   user-global scope is the fixed Host resource and never names one.
 * @returns present metadata, confirmed absence, or temporary unavailability.
 */
export async function probeScopeInstruction(
  scope: string,
  projectRoot: string,
  resolved: ResolvedConfig,
  fileSystem: FileSystem,
  signal?: AbortSignal,
  agentId?: string,
): Promise<ScopeInstructionProbe> {
  const { directory, candidateName } = decodeScopeKey(scope)
  const hostRoot = resolved.hostInstructionRoots.find(root => hostRuleDirectory(root) === directory)
  const dir = hostRoot !== undefined
    ? hostRoot
    : directory === USER_GLOBAL_DIRECTORY
      ? resolved.dshHome
      : directory === '.' ? projectRoot : join(projectRoot, directory)
  const absolutePath = join(dir, candidateName)
  // resolve() follows a final-component symlink; stat then classifies the target.
  // A non-file target (missing, or a link to a directory) is a confirmed absence;
  // only a provider exception is reported as unavailable.
  //
  // Both a fixed Host rule root and the user-global rule are Host resources:
  // their files live in this process, not in the Agent's task container. Asking
  // the remote provider for them needs an agent id they do not have, and the
  // deployment rejects the whole turn before any model call. This process
  // therefore stats them directly, exactly as it read the candidate during
  // baseline discovery.
  // The user-global rule is Host-owned like a fixed Host rule root, unless the
  // provider can read Host paths itself (a Host-backed or explicitly shared
  // backend), in which case its reads stay the recorded source.
  const hostOwned = hostRoot !== undefined
    || (directory === USER_GLOBAL_DIRECTORY
      && (fileSystem.processPathFromHostPath(absolutePath) === undefined))
  let target: FsTarget | undefined
  let info: FsInfo | undefined
  try {
    if (hostOwned) {
      const probe = await nodeStatFile(absolutePath, signal)
      if (probe.kind === 'unavailable') return { kind: 'unavailable' }
      if (probe.kind === 'absent') return { kind: 'absent' }
      info = {
        // `nodeStatFile` always supplies its version token for a present file.
        version: probe.info.version ?? FsVersion('host'),
        type: 'file',
        ...probe.info.size === undefined ? {} : { size: probe.info.size },
      }
    } else {
      target = await fileSystem.resolve(absolutePath, resolutionOptions(agentId, signal))
      info = await fileSystem.stat(target, signal)
    }
  } catch {
    signal?.throwIfAborted()
    return { kind: 'unavailable' }
  }
  if (info?.type !== 'file') return { kind: 'absent' }
  const file: ProbedInstructionFile = {
    absolutePath,
    displayPath: hostRoot !== undefined
      ? hostRootDisplayPath(hostRoot, absolutePath)
      : directory === USER_GLOBAL_DIRECTORY ? userGlobalDisplayPath(resolved.dshHome) : relativeDisplay(projectRoot, absolutePath),
    ...target === undefined ? {} : { target },
    version: info.version,
    ...info.size === undefined ? {} : { size: info.size },
  }
  return { kind: 'present', file }
}

/**
 * Read one already-probed scope candidate under the configured source cap.
 * @param file - winning provider candidate and its metadata snapshot.
 * @param maxSourceBytes - maximum UTF-8 bytes accepted from the source.
 * @param fileSystem - provider used for the streaming read.
 * @param signal - cancellation for provider streaming.
 * @returns loaded content with the probed version, or undefined when unavailable.
 */
export async function readScopeInstruction(
  file: ProbedInstructionFile,
  maxSourceBytes: number,
  fileSystem: FileSystem,
  signal?: AbortSignal,
): Promise<LoadedInstructionFile | undefined> {
  // A Host rule scope was probed without a provider target; read it through the
  // host filesystem again so probe and read agree on the execution world.
  const content = file.target === undefined
    ? await readBoundedHost(file, maxSourceBytes, signal)
    : await readBounded(file, maxSourceBytes, fileSystem, signal)
  if (content === undefined) return undefined
  return {
    absolutePath: file.absolutePath,
    displayPath: file.displayPath,
    content,
    version: file.version,
  }
}

function userGlobalDisplayPath(dshHome: string): string {
  return `${dshHomeDisplay(dshHome)}/AGENTS.md`
}

/**
 * Model-facing display path for a file under a fixed Host rule root.
 *
 * The path keeps a stable Host-root segment so two rule roots, and a Host root
 * beside the project root, cannot share one logical scope key and silently
 * replace each other. The installation location itself stays undisclosed.
 * @param root - configured Host rule root.
 * @param absolutePath - file inside that root.
 * @returns a display path under the host rule namespace.
 */
function hostRootDisplayPath(root: string, absolutePath: string): string {
  return join(hostRuleDirectory(root), relative(root, absolutePath))
}

/**
 * Logical directory a fixed Host rule root occupies in instruction display
 * paths and reconciliation scopes.
 * @param root - configured Host rule root.
 * @returns the root's stable directory segment, derived from its basename.
 */
export function hostRuleDirectory(root: string): string {
  return join(HOST_RULE_DIRECTORY_PREFIX, basename(root))
}
