/** The browser entry mounts the generated Remote contribution through the source-covered lifecycle. */
import { expect, it, vi } from 'vitest'

const generated = vi.hoisted(() => ({ package: '@deepseek-ai/dsh-experimental-api-reflex-local', descriptors: [] }))
const mount = vi.hoisted(() => vi.fn(async () => async () => {}))
vi.mock('@deepseek-ai/dsh-experimental-api-reflex-local/remote', () => ({ default: generated }))
vi.mock('../src/client/mount.ts', () => ({ inject: ['remote', 'slots', 'locale', 'pluginNavigation'], mountReflexLocal: mount }))

it('applies the generated contribution', async () => {
  const entry = await import('../src/client/index.ts')
  const ctx = {} as Parameters<typeof entry.apply>[0]
  expect(entry.inject).toEqual(['remote', 'slots', 'locale', 'pluginNavigation'])
  await entry.apply(ctx)
  expect(mount).toHaveBeenCalledWith(ctx, generated)
})
