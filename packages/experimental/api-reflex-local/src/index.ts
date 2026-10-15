/** Authenticated Client access to local decision engine preparation and enablement. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ReflexLifecycleError } from '@deepseek-ai/dsh-experimental-reflex-local'
import type { ReflexLifecycleErrorCode, ReflexPrepareOptions, ReflexSnapshot, ReflexVariant } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local decision engine Remote controller. */
    reflexLocalController: ReflexLocalController
  }
}

/** Remote failure code of each engine refusal; a new refusal code must be added here and to `RemoteErrorDetailsMap`. */
const REMOTE_CODES: { readonly [Code in ReflexLifecycleErrorCode]: `reflexLocal/${Code}` } = { 'preparing-other': 'reflexLocal/preparing-other' }

/** Rethrow typed engine refusals as Remote failures whose code clients branch on. */
function typed(call: () => void): void {
  try { call() } catch (error) {
    if (!(error instanceof ReflexLifecycleError)) throw error
    throw new RemoteError(REMOTE_CODES[error.code], error.message, error.details, { cause: error })
  }
}

/** Forwards each call to `ctx.reflexLocal`; a disconnected observer never cancels Host-owned preparation. */
export default class ReflexLocalController extends TypertRemoteService {
  static inject = ['reflexLocal', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'reflexLocalController', { namespace: 'reflexLocal' })
  }

  /**
   * Read the current readiness without waiting for a change.
   * @returns the latest device, preparation, and enablement observation.
   */
  @Remote
  snapshot(): ReflexSnapshot { return this.ctx.reflexLocal.snapshot() }

  /**
   * Follow readiness independently of Session and preparation lifetimes.
   * @param signal - Client observation lifetime.
   * @returns the current snapshot followed by each later change.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<ReflexSnapshot> { return this.ctx.reflexLocal.follow(signal) }

  /**
   * Select the given variant, else the variant of a paused or failed preparation, else the recommendation.
   * @param options - variant and download source; omission uses configured origins.
   */
  @Remote
  prepare(options?: ReflexPrepareOptions): void { typed(() => { this.ctx.reflexLocal.prepare(options) }) }

  /**
   * Make a tested downloaded variant active now, or prepare another one in the background while the active one serves.
   * Fails with `reflexLocal/preparing-other` while a different variant is being prepared.
   * @param variant - option to make active.
   */
  @Remote
  select(variant: ReflexVariant): void { typed(() => { this.ctx.reflexLocal.select(variant) }) }

  /**
   * Stop active preparation and keep the partial download for a later `prepare()`.
   * @returns after the work settles.
   */
  @Remote
  pause(): Promise<void> { return this.ctx.reflexLocal.pause() }

  /**
   * Stop active preparation and delete the partial download.
   * @returns after the work settles and the file is removed.
   */
  @Remote
  cancel(): Promise<void> { return this.ctx.reflexLocal.cancel() }

  /**
   * Record the local engine as the chosen Reflex connection mode before any model is prepared.
   * @returns after the choice is persisted.
   */
  @Remote
  chooseLocal(): Promise<void> { return this.ctx.reflexLocal.chooseLocal() }

  /**
   * Start the active model's runner, then route Jev decisions to the local provider; the engine rejects this without an
   * active model or when the runner cannot start.
   * @returns after the runner answers and the change is applied.
   */
  @Remote
  enable(): Promise<void> { return this.ctx.reflexLocal.enable() }

  /**
   * Stop routing Jev decisions to the local provider.
   * @returns after the change is applied.
   */
  @Remote
  disable(): Promise<void> { return this.ctx.reflexLocal.disable() }

  /**
   * Record that a client showed the pending automatic enablement, so later clients do not offer its undo again.
   * @returns after the cleared state is persisted.
   */
  @Remote
  acknowledge(): Promise<void> { return this.ctx.reflexLocal.acknowledge() }

  /**
   * Record that a client showed the pending background model switch.
   * @returns after the cleared state is persisted.
   */
  @Remote
  acknowledgeSwitch(): Promise<void> { return this.ctx.reflexLocal.acknowledgeSwitch() }

  /**
   * Delete one model's weights, partial file, and records; deleting the active model stops its runner and keeps routing.
   * @param variant - option to delete; omission deletes every model.
   * @returns after deletion.
   */
  @Remote
  deleteModel(variant?: ReflexVariant): Promise<void> { return this.ctx.reflexLocal.deleteModel(variant) }
}
