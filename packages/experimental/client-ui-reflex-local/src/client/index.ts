/** Browser entry for the local decision engine Remote contribution and its plugin page surfaces. */
import type { Context } from '@deepseek-ai/cordis'
import reflexLocalRemote from '@deepseek-ai/dsh-experimental-api-reflex-local/remote'
import { mountReflexLocal } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the local decision engine contribution.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountReflexLocal(ctx, reflexLocalRemote)
}
