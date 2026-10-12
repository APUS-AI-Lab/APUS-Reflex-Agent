import { renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopStorageManager, STORAGE_FILENAME, type DesktopStorageOptions } from '../src/main/state/desktop-storage'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function completion() {
  // The Promise constructor initializes the resolver before this function returns.
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const managers = new Map<string, DesktopStorageManager[]>()
function storage(directory: string, options?: DesktopStorageOptions): DesktopStorageManager {
  const manager = new DesktopStorageManager(directory, options)
  managers.set(directory, [...managers.get(directory) ?? [], manager])
  return manager
}

const lockedDirectoryCodes = new Set(['EBUSY', 'EPERM', 'EACCES'])

async function removeTempDir(dir: string): Promise<void> {
  await Promise.all((managers.get(dir) ?? []).map(manager => manager.flush()))
  managers.delete(dir)
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !lockedDirectoryCodes.has(code) || attempt === 7) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

describe('DesktopStorageManager', () => {
  it('starts with empty store when storage file does not exist', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    try {
      const manager = storage(tempDir)
      expect(manager.getAll()).toEqual({})
      expect(manager.getItem('foo')).toBeNull()
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('sets, gets, removes and clears in-memory storage', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    try {
      const manager = storage(tempDir)

      manager.setItem('key1', 'value1')
      manager.setItem('key2', '123')
      expect(manager.getItem('key1')).toBe('value1')
      expect(manager.getItem('key2')).toBe('123')
      expect(manager.getAll()).toEqual({ key1: 'value1', key2: '123' })

      manager.removeItem('key1')
      expect(manager.getItem('key1')).toBeNull()
      expect(manager.getAll()).toEqual({ key2: '123' })

      manager.clear()
      expect(manager.getAll()).toEqual({})
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('flushes synchronously and restores data on reload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    try {
      const manager1 = storage(tempDir)
      manager1.setItem('plugin-theme', 'dark')
      manager1.setItem('plugin-token', 'abc-xyz-999')
      manager1.flushSync()

      const fileContent = await readFile(join(tempDir, STORAGE_FILENAME), 'utf8')
      const parsed = JSON.parse(fileContent)
      expect(parsed).toEqual({
        'plugin-theme': 'dark',
        'plugin-token': 'abc-xyz-999'
      })

      // Simulate a new app launch reading the same profile directory
      const manager2 = storage(tempDir)
      expect(manager2.getItem('plugin-theme')).toBe('dark')
      expect(manager2.getItem('plugin-token')).toBe('abc-xyz-999')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('debounces async flushes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    try {
      const manager = storage(tempDir, { debounceMs: 50 })
      manager.setItem('async-key', 'first')
      manager.setItem('async-key', 'second')

      await vi.advanceTimersByTimeAsync(49)
      await expect(readFile(join(tempDir, STORAGE_FILENAME), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await vi.advanceTimersByTimeAsync(1)
      await manager.flush()

      const fileContent = await readFile(join(tempDir, STORAGE_FILENAME), 'utf8')
      expect(JSON.parse(fileContent)).toEqual({ 'async-key': 'second' })
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('waits for an active write and flushes changes queued behind it before cleanup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-pending-'))
    const entered = completion()
    const release = completion()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered.resolve()
      await release.promise
      return actual.writeFile(...args)
    })
    const manager = storage(tempDir)
    manager.setItem('value', 'first')
    const writing = manager.flush()
    await entered.promise
    let settled = false
    const waiting = manager.flush().then(() => { settled = true })
    try {
      await new Promise(resolve => setImmediate(resolve))
      expect(settled).toBe(false)
      manager.setItem('value', 'latest')
      release.resolve()
      await Promise.all([writing, waiting])
      expect(JSON.parse(await readFile(join(tempDir, STORAGE_FILENAME), 'utf8'))).toEqual({ value: 'latest' })
    } finally {
      release.resolve()
      await Promise.all([writing, waiting])
      await manager.flush()
      await removeTempDir(tempDir)
    }
  })

  it.each(['old', 'shutdown'])('preserves synchronous shutdown value %s when an async write finishes', async (value) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-shutdown-'))
    const entered = completion()
    const release = completion()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered.resolve()
      await release.promise
      return actual.writeFile(...args)
    })
    const manager = storage(tempDir)
    manager.setItem('value', 'old')
    const writing = manager.flush()
    try {
      await entered.promise
      manager.setItem('value', value)
      manager.flushSync()
      expect(JSON.parse(await readFile(join(tempDir, STORAGE_FILENAME), 'utf8'))).toEqual({ value })
      release.resolve()
      await writing
      expect(JSON.parse(await readFile(join(tempDir, STORAGE_FILENAME), 'utf8'))).toEqual({ value })
      expect(await readdir(tempDir)).toEqual([STORAGE_FILENAME])
    } finally {
      release.resolve()
      await writing
      await removeTempDir(tempDir)
    }
  })

  it('keeps an active write in its original profile after a profile switch', async () => {
    const oldProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-old-'))
    const newProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-new-'))
    const entered = completion()
    const release = completion()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered.resolve()
      await release.promise
      return actual.writeFile(...args)
    })
    const manager = storage(oldProfile)
    manager.setItem('profile', 'old')
    const writing = manager.flush()
    try {
      await entered.promise
      manager.switchProfile(newProfile)
      manager.setItem('profile', 'new')
      manager.flushSync()
      release.resolve()
      await writing
      expect(JSON.parse(await readFile(join(oldProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ profile: 'old' })
      expect(JSON.parse(await readFile(join(newProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ profile: 'new' })
    } finally {
      release.resolve()
      await writing
      await removeTempDir(oldProfile)
      await removeTempDir(newProfile)
    }
  })

  it.each(['write', 'rename'] as const)('retains the old Profile and pending settings when %s fails during a switch', async (failure) => {
    const oldProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-failed-old-'))
    const newProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-failed-new-'))
    const onError = vi.fn()
    const manager = storage(oldProfile, { onError })
    const error = new Error(`injected ${failure} failure`)
    try {
      manager.setItem('value', 'persisted')
      manager.flushSync()
      manager.setItem('value', 'pending')
      const fail = () => { throw error }
      if (failure === 'write') vi.mocked(writeFileSync).mockImplementationOnce(fail)
      else vi.mocked(renameSync).mockImplementationOnce(fail)

      expect(() => manager.switchProfile(newProfile)).toThrow('Cannot switch Profile')
      expect(onError).toHaveBeenCalledWith(error, 'sync-flush')
      expect(manager.getStorageFilePath()).toBe(join(oldProfile, STORAGE_FILENAME))
      expect(manager.getAll()).toEqual({ value: 'pending' })
      expect(JSON.parse(await readFile(join(oldProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ value: 'persisted' })
      expect(await readdir(oldProfile)).toEqual([STORAGE_FILENAME])
      expect(await readdir(newProfile)).toEqual([])

      await manager.flush()
      expect(JSON.parse(await readFile(join(oldProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ value: 'pending' })
      manager.switchProfile(newProfile)
      expect(manager.getStorageFilePath()).toBe(join(newProfile, STORAGE_FILENAME))
      expect(manager.getAll()).toEqual({})
    } finally {
      await removeTempDir(oldProfile)
      await removeTempDir(newProfile)
    }
  })

  it('retains newer settings after an active write outlives a failed Profile switch', async () => {
    const oldProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-pending-old-'))
    const newProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-pending-new-'))
    const entered = completion()
    const release = completion()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered.resolve()
      await release.promise
      return actual.writeFile(...args)
    })
    const manager = storage(oldProfile)
    manager.setItem('value', 'old')
    const writing = manager.flush()
    try {
      await entered.promise
      manager.setItem('value', 'latest')
      vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('injected rename failure') })
      expect(() => manager.switchProfile(newProfile)).toThrow('Cannot switch Profile')
      release.resolve()
      await writing
      expect(manager.getStorageFilePath()).toBe(join(oldProfile, STORAGE_FILENAME))
      expect(manager.getAll()).toEqual({ value: 'latest' })
      expect(await readdir(newProfile)).toEqual([])
      await manager.flush()
      expect(JSON.parse(await readFile(join(oldProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ value: 'latest' })
      expect(await readdir(oldProfile)).toEqual([STORAGE_FILENAME])
    } finally {
      release.resolve()
      await writing
      await removeTempDir(oldProfile)
      await removeTempDir(newProfile)
    }
  })

  it('reports an asynchronous save failure and retains settings for a later retry', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-retry-'))
    const onError = vi.fn()
    const manager = storage(tempDir, { onError })
    const error = new Error('injected asynchronous write failure')
    try {
      manager.setItem('value', 'persisted')
      manager.flushSync()
      manager.setItem('value', 'pending')
      vi.mocked(writeFile).mockRejectedValueOnce(error)
      await manager.flush()
      expect(onError).toHaveBeenCalledExactlyOnceWith(error, 'async-flush')
      expect(manager.getAll()).toEqual({ value: 'pending' })
      expect(JSON.parse(await readFile(join(tempDir, STORAGE_FILENAME), 'utf8'))).toEqual({ value: 'persisted' })
      await manager.flush()
      expect(JSON.parse(await readFile(join(tempDir, STORAGE_FILENAME), 'utf8'))).toEqual({ value: 'pending' })
      expect(await readdir(tempDir)).toEqual([STORAGE_FILENAME])
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('does not dirty the new Profile when an obsolete write fails after switching', async () => {
    const oldProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-stale-old-'))
    const newProfile = await mkdtemp(join(tmpdir(), 'dsh-storage-stale-new-'))
    const entered = completion()
    const release = completion()
    const error = new Error('injected obsolete write failure')
    const onError = vi.fn()
    vi.mocked(writeFile).mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      throw error
    })
    const writesBefore = vi.mocked(writeFile).mock.calls.length
    const manager = storage(oldProfile, { onError })
    manager.setItem('profile', 'old')
    const writing = manager.flush()
    try {
      await entered.promise
      manager.switchProfile(newProfile)
      manager.setItem('profile', 'new')
      manager.flushSync()
      release.resolve()
      await writing
      await manager.flush()
      expect(onError).toHaveBeenCalledExactlyOnceWith(error, 'async-flush')
      expect(vi.mocked(writeFile).mock.calls.length - writesBefore).toBe(1)
      expect(JSON.parse(await readFile(join(oldProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ profile: 'old' })
      expect(JSON.parse(await readFile(join(newProfile, STORAGE_FILENAME), 'utf8'))).toEqual({ profile: 'new' })
      expect(await readdir(oldProfile)).toEqual([STORAGE_FILENAME])
      expect(await readdir(newProfile)).toEqual([STORAGE_FILENAME])
    } finally {
      release.resolve()
      await writing
      await removeTempDir(oldProfile)
      await removeTempDir(newProfile)
    }
  })

  it('handles corrupted JSON files gracefully without throwing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    try {
      await writeFile(join(tempDir, STORAGE_FILENAME), 'INVALID_NOT_A_JSON{', 'utf8')

      let reportedError = false
      const manager = storage(tempDir, {
        onError: (_err, context) => {
          if (context === 'load-from-disk') reportedError = true
        }
      })

      expect(reportedError).toBe(true)
      expect(manager.getAll()).toEqual({})

      // Still allows writing and overwrites corrupted file cleanly
      manager.setItem('recovered', 'true')
      manager.flushSync()

      const restored = storage(tempDir)
      expect(restored.getItem('recovered')).toBe('true')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('applies batch actions correctly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-storage-test-'))
    try {
      const manager = storage(tempDir)
      manager.applyAction({ type: 'set', key: 'a', val: '1' })
      manager.applyAction({ type: 'set', key: 'b', val: '2' })
      expect(manager.getAll()).toEqual({ a: '1', b: '2' })

      manager.applyAction({ type: 'remove', key: 'a' })
      expect(manager.getAll()).toEqual({ b: '2' })

      manager.applyAction({ type: 'clear' })
      expect(manager.getAll()).toEqual({})
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('supports switching profiles', async () => {
    const dir1 = await mkdtemp(join(tmpdir(), 'dsh-profile1-'))
    const dir2 = await mkdtemp(join(tmpdir(), 'dsh-profile2-'))
    try {
      const manager = storage(dir1)
      manager.setItem('p1', 'val1')
      manager.flushSync()

      manager.switchProfile(dir2)
      expect(manager.getAll()).toEqual({})

      manager.setItem('p2', 'val2')
      manager.flushSync()

      const restored1 = storage(dir1)
      const restored2 = storage(dir2)
      expect(restored1.getItem('p1')).toBe('val1')
      expect(restored2.getItem('p2')).toBe('val2')
    } finally {
      await removeTempDir(dir1)
      await removeTempDir(dir2)
    }
  })
})
