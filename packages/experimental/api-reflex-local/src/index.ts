/** Authenticated Client access to local decision engine preparation and enablement. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-reflex-local'
import type { ReflexPrepareOptions, ReflexSnapshot } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local decision engine Remote controller. */
    reflexLocalController: ReflexLocalController
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
   * Start or join download, verification, and self-test.
   * @param options - variant and download source; omission uses the device recommendation and configured origins.
   */
  @Remote
  prepare(options?: ReflexPrepareOptions): void { this.ctx.reflexLocal.prepare(options) }

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
   * Route Jev decisions to the local provider; the engine rejects this unless preparation is ready.
   * @returns after the change is applied.
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
   * Turn local decisions off, stop the runner, and delete downloaded weights and partial files.
   * @returns after deletion.
   */
  @Remote
  deleteModel(): Promise<void> { return this.ctx.reflexLocal.remove() }
}
