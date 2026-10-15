import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import { afterEach, expect, it, vi } from 'vitest'
import { PRIMARY_RUNTIME_SOURCE_ENV, publishPrimaryRuntimeSource } from '../src/primary-runtime-source.ts'

afterEach(() => { vi.unstubAllEnvs() })

it('publishes the shell-supplied payload directory, or the resource sibling of the dependency directory', () => {
  const environment: NodeJS.ProcessEnv = { [PRIMARY_RUNTIME_SOURCE_ENV]: '/inherited/primary-runtime' }
  expect(publishPrimaryRuntimeSource('/app/dsh', '/prepared/primary-runtime', environment)).toBe('/prepared/primary-runtime')
  expect(environment[PRIMARY_RUNTIME_SOURCE_ENV]).toBe('/prepared/primary-runtime')
  const runtimeDir = join('/Applications', 'Desktop.app', 'Contents', 'Resources', 'dsh')
  const fallback = join(runtimeDir, '..', 'runtime', 'primary-runtime')
  expect(publishPrimaryRuntimeSource(runtimeDir, undefined, environment)).toBe(fallback)
  expect(environment[PRIMARY_RUNTIME_SOURCE_ENV]).toBe(fallback)
})

it.each([
  ['the published payload', '/prepared/primary-runtime', '/prepared/primary-runtime/dependencies/llama-server/llama-server'],
  ['an unset variable', undefined, undefined],
  ['an empty variable', '', undefined],
])('resolves an optional runner path from %s in Loader configuration', async (_case, value, expected) => {
  vi.stubEnv(PRIMARY_RUNTIME_SOURCE_ENV, value)
  const root = await mkdtemp(join(tmpdir(), 'desktop-primary-runtime-source-'))
  const ctx = new Context()
  const received: { runnerPath?: string | undefined }[] = []
  const runner = {
    name: 'runner',
    Config: z.object({ runnerPath: z.union([z.string().min(1), z.const(undefined)]) }),
    apply: (_ctx: Context, config: { runnerPath?: string | undefined }) => { received.push(config) },
  }
  try {
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.runner = runner
    const config = join(root, 'cordis.yml')
    await writeFile(config, [
      '- name: cordis:runner',
      '  config:',
      `    runnerPath: !!js "process.env.${PRIMARY_RUNTIME_SOURCE_ENV} ? process.env.${PRIMARY_RUNTIME_SOURCE_ENV} + '/dependencies/llama-server/llama-server' : undefined"`,
      '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) await entry.fiber?.await()
    expect(received).toEqual([expected === undefined ? {} : { runnerPath: expected }])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
