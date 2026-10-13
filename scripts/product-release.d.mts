/** Product distribution with or without the Office engine. */
export type ProductEdition = 'full' | 'lite'

/** Version and platform declaration owned by the integrated product. */
export interface ReleaseManifest {
  product: string
  version: string
  channel: string
  repository: string
  targets: string[]
  editions: ProductEdition[]
}
/** Receipt created only after a successful installer build. */
export interface BuildReceipt {
  version: string
  edition: ProductEdition
  sourceRevision: string
  target: string
  signing: string
  runtimeDependencyInventorySha256?: string | undefined
  directory: string
  assets: { name: string; sha256: string }[]
}
/** Reject disagreement between the product, desktop and npm lock versions. */
export function validateRelease(manifest: ReleaseManifest, desktop: { version: string }, lock: { version: string; packages: Record<string, { version?: string }> }): ReleaseManifest
/** Check the selected checkout and optional tag. */
export function checkRelease(base?: string, tag?: string): ReleaseManifest
/** Installer names for one qualified platform. */
export function releaseAssetNames(platform: string, arch: string, edition?: string): string[]
/** Bind the successful builder's files to the current product commit. */
export function recordBuild(directory: string, base?: string, edition?: string): void
/** Verify source identity, owned output location and installer digests. */
export function verifyReceipt(receipt: BuildReceipt, manifest: ReleaseManifest, revision: string, target: string, hashFile: (file: string) => string, base?: string, edition?: string): string
/** Collect verified preview assets without uploading them. */
export function collectRelease(unsigned: boolean, base?: string, edition?: string): Promise<void>

/** Inputs already verified by release collection; output contains the copied installers. */
export interface ReleaseSupportAssetsInput {
  base: string
  output: string
  manifest: ReleaseManifest
  runtime: { edition: ProductEdition; version: string; dependencyInventory: { path: string; sha256: string } }
  revision: string
  target: string
  assets: string[]
  edition?: string
}
/** Write platform-specific metadata, notices, dependency inventory, and checksums. */
export function writeReleaseSupportAssets(input: ReleaseSupportAssetsInput): Promise<{ info: string; licenses: string; inventory: string; checksums: string }>
/** Unique supporting filenames for one edition and native target. */
export function releaseSupportNames(target: string, edition?: string): { info: string; licenses: string; inventory: string; checksums: string }
