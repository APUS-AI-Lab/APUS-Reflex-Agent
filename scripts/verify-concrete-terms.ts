/** Reject one ambiguous origin label from maintained tracked files. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { historicalSchemaRegion } from './historical-schema-region.ts'

const root = resolve(import.meta.dirname, '..')
const blockedTerm = 'prove' + 'nance'
const excludedPrefixes = ['vendor/', '.agents/notes/archived/'] as const

// Imported historical review and third-party attribution must retain their original bytes.
const frozenFrontendFiles = new Map([
  [`frontend/docs/ppt-implementation-${blockedTerm}-and-remediation-2026-09-06.md`, '74c7818de809fbc48866394e15846998525e5f11c8b3cfa993f3ddaaa578c5bb'],
  ['frontend/packages/ppt-runtime/adapter/THIRD_PARTY_NOTICES.md', 'b6fa7b37279728d366b75c748b413a48ae864164f24cf336b2c2004c2846ba57'],
  ['frontend/packages/ppt-runtime/core/THIRD_PARTY_NOTICES.md', 'b6fa7b37279728d366b75c748b413a48ae864164f24cf336b2c2004c2846ba57'],
])
const importedTemplateMetadata = new Set([
  'curated-modular-logistics-system', 'curated-nordic-operating-report', 'curated-swiss-signal-grid',
  'dsh-course-workshop', 'dsh-editorial-notebook', 'dsh-engineering-blueprint',
].map(slug => `frontend/scripts/ppt/base-templates/${slug}/metadata.json`))
// These exact generator statements emit the retained serialized template field.
const importedGeneratorLines = new Map([
  ['frontend/scripts/generate-ppt-templates.mjs', '1df00384e724bfa04b0315c2154848c4b15e76d5d7f2f551f51cd2877be1eec6'],
  ['frontend/scripts/generate-zara-ppt-templates.mjs', '0ddb2a114aac8409ed5ea63634ffc658142a0b2033e09c56807dd15c21cbd487'],
])

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** One blocked term occurrence in a tracked path or text line. */
export interface ConcreteTermViolation {
  /** Repository-relative tracked path. */
  file: string
  /** One-based source line, or null when the path contains the term. */
  line: number | null
}

function isExcluded(file: string): boolean {
  return excludedPrefixes.some(prefix => file.startsWith(prefix))
    // Release snapshots retain the identifiers present in their pinned source;
    // historical-format pairing records key sections by those identifiers' headings.
    || /^docs\/persistence-changes\/releases\/dsh-v\d+\.\d+\.\d+-(?:alpha|rc)\.\d+\.schema\.json$/u.test(file)
    || /^docs\/persistence-changes\/historical-formats\/v(?:0|[1-9]\d*)\.(?:schema\.json|i18n\.yaml)$/u.test(file)
}

function containsBlockedTerm(value: string): boolean {
  return value.normalize('NFKC').toLowerCase().includes(blockedTerm)
}

/**
 * Find the blocked term in one maintained tracked file.
 * @param file - repository-relative tracked path.
 * @param source - text contents or symlink target.
 * @returns violations outside vendored sources, frozen records, historical schema regions, and retained imported serialization fields.
 */
export function findConcreteTermViolations(file: string, source: string): ConcreteTermViolation[] {
  if (isExcluded(file)) return []
  const frozenHash = frozenFrontendFiles.get(file)
  if (frozenHash !== undefined && frozenHash === digest(source)) return []
  const violations: ConcreteTermViolation[] = []
  if (containsBlockedTerm(file)) violations.push({ file, line: null })
  const lines = source.split(/\r?\n/u)
  const schemaRegion = historicalSchemaRegion(file, source)
  const generatorHash = importedGeneratorLines.get(file)
  let importedFieldAccepted = false
  for (const [index, line] of lines.entries()) {
    if (schemaRegion !== undefined && index >= schemaRegion[0] && index < schemaRegion[1]) continue
    if (!importedFieldAccepted && (
      importedTemplateMetadata.has(file) && line === `  "${blockedTerm}": {`
      || generatorHash !== undefined && generatorHash === digest(line)
    )) {
      importedFieldAccepted = true
      continue
    }
    if (containsBlockedTerm(line)) violations.push({ file, line: index + 1 })
  }
  return violations
}

function trackedFiles(repoRoot: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '')
  if (!files.includes('AGENTS.md')
    || !files.some(file => file.startsWith('packages/'))
    || !files.some(file => file.startsWith('docs/'))
    || !files.some(file => file.startsWith('vendor/'))
    || !files.some(file => file.startsWith('.agents/notes/archived/'))) {
    throw new Error('verify-concrete-terms: tracked-file discovery omitted a required repository area')
  }
  return files
}

/**
 * Read one tracked file without following a symlink to its target.
 * @param repoRoot - Repository root containing the tracked path.
 * @param file - Repository-relative tracked path.
 * @returns File text, the symlink target, or undefined when the path is absent or not a file.
 */
export function readTrackedSource(repoRoot: string, file: string): string | undefined {
  const path = resolve(repoRoot, file)
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat === undefined) return undefined
  if (stat.isSymbolicLink()) return readlinkSync(path)
  return stat.isFile() ? readFileSync(path, 'utf8') : undefined
}

function scanRepository(repoRoot: string): ConcreteTermViolation[] {
  const violations: ConcreteTermViolation[] = []
  for (const file of trackedFiles(repoRoot)) {
    const source = readTrackedSource(repoRoot, file)
    if (source === undefined) continue
    violations.push(...findConcreteTermViolations(file, source))
  }
  return violations
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const violations = scanRepository(root)
  if (violations.length === 0) {
    console.log(`verify-concrete-terms: maintained tracked files contain no ${blockedTerm}.`)
  } else {
    console.error(`verify-concrete-terms: ${blockedTerm} is forbidden; name the exact source, field, identity, or evidence:`)
    for (const violation of violations) {
      console.error(violation.line === null
        ? `  ${violation.file} (path)`
        : `  ${violation.file}:${String(violation.line)}`)
    }
    process.exitCode = 1
  }
}
