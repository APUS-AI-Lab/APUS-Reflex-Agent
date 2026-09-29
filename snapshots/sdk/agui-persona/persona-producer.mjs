/** Apply the bridge’s production persona to a real SDK-profile Agent. */
import { DEFAULT_PERSONA, installPersona } from '@deepseek-ai/dsh-experimental-agui'

export const name = 'snapshot-agui-persona'
export const inject = ['agents', 'systemPrompt', 'tools']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Runtime services. */
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    installPersona(agent.ctx, { persona: DEFAULT_PERSONA })
  })
}
