/** The browser entry mounts the generated Reflex Remote contribution through the source-covered lifecycle. */
import { expect, it, vi } from 'vitest'

const generated = vi.hoisted(() => ({ package: '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', descriptors: [] }))
const mount = vi.hoisted(() => vi.fn(async () => async () => {}))
vi.mock('@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin/remote', () => ({ default: generated }))
vi.mock('../src/client/mount.ts', () => ({ inject: ['remote'], mountSystem3: mount }))

it('applies the generated contribution', async () => {
  const entry = await import('../src/client/index.ts')
  const ctx = {} as Parameters<typeof entry.apply>[0]
  expect(entry.inject).toEqual(['remote'])
  await entry.apply(ctx)
  expect(mount).toHaveBeenCalledWith(ctx, generated)
})
