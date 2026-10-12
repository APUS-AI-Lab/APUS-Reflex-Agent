import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const STORAGE_FILENAME = 'desktop-storage.json'

export type DesktopStorageAction =
  | { type: 'set'; key: string; val: string }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

export interface DesktopStorageOptions {
  debounceMs?: number
  onError?: (error: Error, context: string) => void
}

export class DesktopStorageManager {
  private memoryStore: Map<string, string> = new Map()
  private filePath: string
  private debounceMs: number
  private flushTimer?: NodeJS.Timeout
  private isDirty = false
  private activeFlush?: Promise<void>
  private snapshotVersion = 0
  private onError?: (error: Error, context: string) => void

  constructor(profileDirectory: string, options: DesktopStorageOptions = {}) {
    this.filePath = join(profileDirectory, STORAGE_FILENAME)
    this.debounceMs = options.debounceMs ?? 200
    this.onError = options.onError
    this.loadFromDiskSync()
  }

  getStorageFilePath(): string {
    return this.filePath
  }

  /**
   * Returns a snapshot of all stored keys and values.
   */
  getAll(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of this.memoryStore.entries()) {
      result[key] = value
    }
    return result
  }

  getItem(key: string): string | null {
    return this.memoryStore.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    const stringKey = String(key)
    const stringVal = String(value)
    if (this.memoryStore.get(stringKey) === stringVal) return
    this.memoryStore.set(stringKey, stringVal)
    this.markDirty()
  }

  removeItem(key: string): void {
    const stringKey = String(key)
    if (!this.memoryStore.has(stringKey)) return
    this.memoryStore.delete(stringKey)
    this.markDirty()
  }

  clear(): void {
    if (this.memoryStore.size === 0) return
    this.memoryStore.clear()
    this.markDirty()
  }

  applyAction(action: DesktopStorageAction): void {
    switch (action.type) {
      case 'set':
        this.setItem(action.key, action.val)
        break
      case 'remove':
        this.removeItem(action.key)
        break
      case 'clear':
        this.clear()
        break
    }
  }

  /**
   * Switch the storage manager to a new profile directory.
   * Flushes pending changes first; a failed save throws and retains the previous Profile and settings.
   */
  switchProfile(profileDirectory: string): void {
    this.flushSync()
    if (this.isDirty) throw new Error('Cannot switch Profile because pending desktop settings could not be saved.')
    this.filePath = join(profileDirectory, STORAGE_FILENAME)
    this.memoryStore.clear()
    this.loadFromDiskSync()
  }

  /**
   * Waits for active writes and flushes dirty state before resolving.
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.activeFlush !== undefined) {
      await this.activeFlush
      return this.flush()
    }
    if (!this.isDirty) return
    this.activeFlush = this.writeSnapshot()
    try {
      await this.activeFlush
    } finally {
      this.activeFlush = undefined
    }
  }

  private async writeSnapshot(): Promise<void> {
    this.isDirty = false
    const filePath = this.filePath
    const version = this.snapshotVersion
    const serialized = JSON.stringify(this.getAll(), null, 2)
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`

    try {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(tmpPath, serialized, 'utf8')
      if (version !== this.snapshotVersion) {
        await rm(tmpPath, { force: true })
        return
      }
      // Commit without yielding so flushSync cannot publish between the version check and rename.
      renameSync(tmpPath, filePath)
    } catch (error) {
      if (version === this.snapshotVersion) this.isDirty = true
      this.handleError(error, 'async-flush')
    }
  }

  /**
   * Persists the current state synchronously, superseding any active asynchronous snapshot.
   */
  flushSync(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (!this.isDirty && this.activeFlush === undefined) return

    this.snapshotVersion++
    this.isDirty = false
    const serialized = JSON.stringify(this.getAll(), null, 2)
    const tmpPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`

    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(tmpPath, serialized, 'utf8')
      renameSync(tmpPath, this.filePath)
    } catch (error) {
      this.isDirty = true
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath)
      } catch {}
      this.handleError(error, 'sync-flush')
    }
  }

  private markDirty(): void {
    this.isDirty = true
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  private loadFromDiskSync(): void {
    this.isDirty = false
    if (!existsSync(this.filePath)) {
      return
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8').trim()
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') {
            this.memoryStore.set(k, v)
          } else {
            this.memoryStore.set(k, String(v))
          }
        }
      }
    } catch (error) {
      this.handleError(error, 'load-from-disk')
    }
  }

  private handleError(error: unknown, context: string): void {
    const err = error instanceof Error ? error : new Error(String(error))
    if (this.onError) {
      this.onError(err, context)
    }
  }
}
