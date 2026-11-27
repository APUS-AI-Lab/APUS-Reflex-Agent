import { afterEach, describe, expect, it } from 'vitest'
import { execFile, execFileSync, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { RemoteFileSystem } from '../src/index.ts'
import { probeCommand } from '../src/probe.ts'

const servers: Server[] = []
const roots: string[] = []
const contexts: Context[] = []
const children: Array<{ child: ChildProcess; done: Promise<void> }> = []

afterEach(async () => {
  await Promise.all(children.splice(0).map(async ({ child, done }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await done
  }))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Run the probe the way the container does, in a real working directory. */
function runProbe(command: string): { stdout: string; return_code: number } {
  // The command is `<python> <decoder> <script-b64> <request-b64>`; running it
  // through the shell is exactly what the container does.
  try {
    const stdout = execFileSync('sh', ['-c', command], { encoding: 'utf8' })
    return { stdout, return_code: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; status?: number }
    return { stdout: failure.stdout ?? '', return_code: failure.status ?? 1 }
  }
}

async function service(answer?: (command: string) => unknown): Promise<{ endpoint: string; seen: string[] }> {
  const seen: string[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      seen.push(request.url ?? '')
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { command?: string }
      const result = answer === undefined ? runProbe(body.command ?? '') : answer(body.command ?? '')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { endpoint: `http://127.0.0.1:${address.port}`, seen }
}

async function fsFor(endpoint: string): Promise<RemoteFileSystem> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(RemoteFileSystem, { endpoint, timeoutSec: 30 })
  return ctx.fs as RemoteFileSystem
}

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fs-remote-'))
  roots.push(root)
  return root
}

// The task-container probe uses Linux fcntl and POSIX command execution.
describe.skipIf(process.platform === 'win32')('remote filesystem', () => {
  it('resolves aliases to one target and stats the target rather than its link', async () => {
    const root = workspace()
    const file = join(root, 'file.txt')
    writeFileSync(file, 'content')
    symlinkSync(file, join(root, 'alias'))
    symlinkSync(join(root, 'missing'), join(root, 'dangling'))
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const options = { cwd: root, agentId: 'case-links' }

    const target = await fs.resolve('file.txt', options)
    const alias = await fs.resolve('alias', options)

    expect(alias.targetKey).toBe(target.targetKey)
    expect((await fs.stat(alias))?.type).toBe('file')
    expect((await fs.lstat('alias', options))?.type).toBe('symlink')
    expect((await fs.lstat('dangling', options))?.type).toBe('symlink')
    expect(await fs.lstat('absent', options)).toBeUndefined()
    expect((await fs.listDir(await fs.resolve('.', options))).find(entry => entry.name === 'alias')?.target.targetKey).toBe(target.targetKey)
  })

  it('reads bytes completely within an inclusive cap and refuses overflow', async () => {
    const root = workspace()
    writeFileSync(join(root, 'bytes'), Buffer.from([0, 0xff, 3, 4]))
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const target = await fs.resolve('bytes', { cwd: root, agentId: 'case-bytes' })

    expect([...await fs.readBytes(target, undefined, 4)]).toEqual([0, 255, 3, 4])
    await expect(fs.readBytes(target, undefined, 3)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    await expect(fs.readBytes(target, undefined, 0)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    expect([...await fs.readByteRange(target, { offset: 1, length: 2 })]).toEqual([255, 3])
    expect([...await fs.readByteRange(target, { offset: 8, length: 2 })]).toEqual([])
    expect([...await fs.readByteRange(target, { offset: 0, length: 0 })]).toEqual([])
    await expect(fs.readByteRange(target, { offset: -1, length: 2 })).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
  })

  it('streams UTF-8 across byte boundaries and rejects binary, directories and cancellation', async () => {
    const root = workspace()
    const content = 'x'.repeat(65_535) + '中文🙂\r\n'
    writeFileSync(join(root, 'text'), content)
    writeFileSync(join(root, 'binary'), Buffer.from([65, 0, 66]))
    writeFileSync(join(root, 'invalid'), Buffer.from([0xff]))
    writeFileSync(join(root, 'empty'), '')
    const { endpoint, seen } = await service()
    const fs = await fsFor(endpoint)
    const options = { cwd: root, agentId: 'case-text' }
    const target = await fs.resolve('text', options)
    const chunks: string[] = []
    for await (const chunk of await fs.streamText(target)) chunks.push(chunk)
    expect(chunks.join('')).toBe(content)
    for (const name of ['binary', 'invalid']) {
      const file = await fs.resolve(name, options)
      await expect(fs.readText(file)).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
      await expect(async () => { for await (const _chunk of await fs.streamText(file)) { /* consume */ } }).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
    }
    const directory = await fs.resolve('.', options)
    await expect(fs.readText(directory)).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    await expect(fs.readBytes(directory, undefined, 10)).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    const empty = await fs.resolve('empty', options)
    expect(await fs.readText(empty)).toBe('')
    expect([...await fs.readBytes(empty, undefined, 0)]).toEqual([])
    const count = seen.length
    const signal = AbortSignal.abort()
    await expect(fs.readText(target, signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(seen).toHaveLength(count)
  })

  it('guards writes and normalizes edit outcomes without damaging rejected files', async () => {
    const root = workspace()
    const path = join(root, 'guarded')
    writeFileSync(path, 'alpha\r\nbeta\r\n')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const target = await fs.resolve('guarded', { cwd: root, agentId: 'case-write' })
    await expect(fs.writeText(target, 'overwrite', { kind: 'createIfAbsent' })).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    expect(readFileSync(path, 'utf8')).toBe('alpha\r\nbeta\r\n')
    await expect(fs.editText(target, { oldString: '', newString: 'x', replaceAll: false })).rejects.toMatchObject({ code: 'FS_EDIT_NOT_FOUND' })
    expect(readFileSync(path, 'utf8')).toBe('alpha\r\nbeta\r\n')
    const edit = await fs.editText(target, { oldString: 'beta\r\n', newString: 'gamma\r\n', replaceAll: false })
    expect(edit.before).toBe('alpha\nbeta\n')
    expect(edit.after).toBe('alpha\ngamma\n')
    expect(readFileSync(path, 'utf8')).toBe('alpha\r\ngamma\r\n')
    const write = await fs.writeText(target, 'new\r\n')
    expect(write.before).toBe('alpha\ngamma\n')
    expect(write.after).toBe('new\n')
    const info = await fs.stat(target)
    if (info === undefined) throw new Error('expected the file to exist')
    unlinkSync(path)
    await expect(fs.writeText(target, 'must not recreate', { kind: 'replaceIfVersion', version: info.version })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await fs.stat(target)).toBeUndefined()
  })

  it('enforces write policy on the canonical path, including symlink escapes', async () => {
    const root = workspace()
    const outside = workspace()
    writeFileSync(join(root, 'file'), 'original')
    symlinkSync(outside, join(root, 'escape'))
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const options = { cwd: root, agentId: 'case-policy' }
    const file = await fs.resolve('file', options)
    const escape = await fs.resolve('escape/secret', options)
    await expect(fs.writeText(file, 'forbidden', undefined, undefined, { mode: 'read-only', workspaceRoot: root })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    await expect(fs.writeText(escape, 'forbidden', undefined, undefined, { mode: 'workspace-write', workspaceRoot: root })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    await expect(fs.editText(file, { oldString: 'original', newString: 'forbidden', replaceAll: false }, undefined, undefined, { mode: 'read-only', workspaceRoot: root })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    expect(readFileSync(join(root, 'file'), 'utf8')).toBe('original')
    expect(await fs.stat(escape)).toBeUndefined()
    await fs.writeText(file, 'allowed', undefined, undefined, { mode: 'workspace-write', workspaceRoot: root })
    expect(await fs.readText(file)).toBe('allowed')
    await fs.writeText(escape, 'explicit access', undefined, undefined, { mode: 'danger-full-access', workspaceRoot: root })
    expect(readFileSync(join(outside, 'secret'), 'utf8')).toBe('explicit access')
  })

  it.each([
    { return_code: 3, stdout: '{"ok":true,"path":"/tmp"}' },
    { return_code: 0, refused: true, stdout: '{"ok":true,"path":"/tmp"}' },
    { return_code: 0, stdout: '' },
    { return_code: 0, stdout: '{}' },
    { return_code: 0, stdout: '{"ok":true}' },
    { return_code: 0, stdout: '{"ok":true,"path":42}' },
    { return_code: 0, stdout: '{"ok":true,"path":"relative"}' },
    { return_code: 0, stdout: 'null' },
    { return_code: 0, stdout: '[]' },
    { return_code: 0, stdout: 'noise\n{"ok":true,"path":"/tmp"}' },
    {},
    null,
  ])('rejects failed execution and malformed probe data: %j', async (answer) => {
    const { endpoint } = await service(() => answer)
    const fs = await fsFor(endpoint)
    await expect(fs.resolve('file', { cwd: '/tmp', agentId: 'case-bad-response' })).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
  })

  it('serializes independent guarded probe processes for the same file', async () => {
    const root = workspace()
    const path = join(root, 'concurrent')
    writeFileSync(path, 'original')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const target = await fs.resolve('concurrent', { cwd: root, agentId: 'case-concurrency' })
    const info = await fs.stat(target)
    if (info === undefined) throw new Error('expected the file to exist')
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const command = probeCommand({ op: 'write', path, content: String(index), expectedVersion: String(info.version) })
      const child = execFile('sh', ['-c', command], (error, stdout) => {
        if (error) reject(error)
        else {
          try { resolve(JSON.parse(stdout) as Record<string, unknown>) } catch (error) { reject(error) }
        }
      })
      children.push({ child, done: new Promise<void>(resolve => child.once('close', () => resolve())) })
    })))
    expect(results.filter(result => result.ok === true)).toHaveLength(1)
    expect(results.filter(result => result.code === 'FS_STALE_VERSION')).toHaveLength(5)
  })

  it('reads a file that exists only in the task environment', async () => {
    const root = workspace()
    writeFileSync(join(root, 'answer.txt'), 'from the task\n')
    const { endpoint, seen } = await service()
    const fs = await fsFor(endpoint)

    const target = await fs.resolve('answer.txt', { cwd: root, agentId: 'case-7' })
    const text = await fs.readText(target)

    expect(text).toBe('from the task\n')
    // The service routes by the agent's session, as the shell channel does.
    expect(seen[0]).toBe('/jobs/by-session/case-7/exec')
  })

  it('reports a missing file as not found rather than an infrastructure fault', async () => {
    const root = workspace()
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)

    const target = await fs.resolve('absent.txt', { cwd: root, agentId: 'case-1' })

    expect(await fs.stat(target)).toBeUndefined()
    await expect(fs.readText(target)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })

  it('lists a directory with each child addressable', async () => {
    const root = workspace()
    mkdirSync(join(root, 'pkg'))
    writeFileSync(join(root, 'pkg', 'a.py'), 'x = 1\n')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)

    const target = await fs.resolve('pkg', { cwd: root, agentId: 'case-2' })
    const entries = await fs.listDir(target)

    expect(entries.map(entry => entry.name)).toEqual(['a.py'])
    expect(await fs.readText(entries[0]!.target)).toBe('x = 1\n')
  })

  it('writes a file into the task environment', async () => {
    const root = workspace()
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)

    const target = await fs.resolve('out.txt', { cwd: root, agentId: 'case-3' })
    const outcome = await fs.writeText(target, 'written by the model\n')

    expect(outcome.operation).toBe('create')
    expect(await fs.readText(target)).toBe('written by the model\n')
  })

  it('refuses a write whose version no longer matches', async () => {
    const root = workspace()
    writeFileSync(join(root, 'f.txt'), 'v1\n')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const target = await fs.resolve('f.txt', { cwd: root, agentId: 'case-4' })
    const info = await fs.stat(target)
    if (info === undefined) throw new Error('expected the file to exist')
    writeFileSync(join(root, 'f.txt'), 'changed elsewhere\n')

    await expect(
      fs.writeText(target, 'mine\n', { kind: 'replaceIfVersion', version: info.version }),
    ).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  })

  it('edits a file and reports the text on both sides', async () => {
    const root = workspace()
    writeFileSync(join(root, 'e.txt'), 'alpha beta\n')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const target = await fs.resolve('e.txt', { cwd: root, agentId: 'case-5' })

    const outcome = await fs.editText(target, {
      oldString: 'beta', newString: 'gamma', replaceAll: false,
    })

    expect(outcome.before).toBe('alpha beta\n')
    expect(outcome.after).toBe('alpha gamma\n')
    expect(await fs.readText(target)).toBe('alpha gamma\n')
  })

  it('refuses an edit whose text is not in the file', async () => {
    const root = workspace()
    writeFileSync(join(root, 'g.txt'), 'nothing here\n')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)
    const target = await fs.resolve('g.txt', { cwd: root, agentId: 'case-6' })

    await expect(
      fs.editText(target, { oldString: 'absent', newString: 'x', replaceAll: false }),
    ).rejects.toMatchObject({ code: 'FS_EDIT_NOT_FOUND' })
  })

  it('refuses a request that names no agent instead of guessing a container', async () => {
    const { endpoint, seen } = await service()
    const fs = await fsFor(endpoint)

    await expect(fs.resolve('a.txt', { cwd: '/' })).rejects.toThrow(/names no agent/)
    expect(seen).toEqual([])
  })

  it('keeps two agents apart', async () => {
    const first = workspace()
    const second = workspace()
    writeFileSync(join(first, 'same.txt'), 'one\n')
    writeFileSync(join(second, 'same.txt'), 'two\n')
    const { endpoint } = await service()
    const fs = await fsFor(endpoint)

    const a = await fs.resolve('same.txt', { cwd: first, agentId: 'case-a' })
    const b = await fs.resolve('same.txt', { cwd: second, agentId: 'case-b' })

    expect(await fs.readText(a)).toBe('one\n')
    expect(await fs.readText(b)).toBe('two\n')
    expect(fs.contains(a, b)).toBe(false)
  })
})
