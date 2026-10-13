/** Always-mounted refusal of task-bound model requests without their current authority. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from './task-service.ts'
import { taskBindingProjection } from './task-binding.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Lightweight task-binding guard retained when the optional task authority is absent. */
    continuumTaskGuard: ContinuumTaskGuard
  }
}

/**
 * Owns task-binding recovery in every shipped profile. Unbound Sessions need no
 * task service. Bound Sessions must retain a ready, matching authority; removing
 * the optional task plugin cannot silently reactivate stale history or summaries.
 */
export default class ContinuumTaskGuard extends Service {
  static inject = ['sessions', 'sessionProjections', 'llm']

  constructor(ctx: Context) {
    super(ctx, 'continuumTaskGuard')
    ctx.sessionProjections.register(taskBindingProjection)
    ctx.on('llm/stream', (options, next) => {
      const session = options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId)
      if (session !== undefined) {
        const binding = ctx.sessionProjections.stateOf(session, 'continuumTaskBinding')
        if (binding !== undefined && binding !== null) {
          const authority = ctx.get('continuumTasks')
          if (authority === undefined) throw new Error('task-bound Session requires its configured Continuum task authority')
          authority.assertAuthority(session, binding)
        }
      }
      return next()
    })
  }
}
