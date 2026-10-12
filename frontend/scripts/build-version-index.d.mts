export interface VersionIndexEntry {
  version: string
  tag: string
  archiveUrl: string
}

export interface VersionIndex {
  generatedAt: string
  versions: VersionIndexEntry[]
}

/** Build the rollback version index from `releases/archive/<name>` directory names. */
export function buildVersionIndex(archiveDirNames: string[]): VersionIndex
