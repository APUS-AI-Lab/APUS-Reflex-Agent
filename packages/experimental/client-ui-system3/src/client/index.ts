/** Experimental System3 UI and Reflex Remote assembly. */
import type { Context } from '@deepseek-ai/cordis'
import reflexRemote from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin/remote'
import { mountSystem3 } from './mount.ts'

export { inject } from './mount.ts'

/** Activate the optional UI with its own typed Remote contribution.
 * @param ctx - Client runtime.
 * @returns Complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountSystem3(ctx, reflexRemote)
}
