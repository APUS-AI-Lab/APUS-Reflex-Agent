/** The client-owned persona an AG-UI front-end asks this bridge's agents to speak as. */

import type { Context } from '@deepseek-ai/cordis'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

/** Tones the Personal Agent app lets a person choose. */
export type PersonaTone = 'warm' | 'concise' | 'thoughtful'

export interface Persona {
  readonly name: string
  readonly tone: PersonaTone
}

/** Used until a client sends its own persona. */
export const DEFAULT_PERSONA: Persona = { name: 'Muse', tone: 'warm' }

const TONES: Record<PersonaTone, string> = {
  warm: 'Be warm and encouraging, and keep answers easy to follow.',
  concise: 'Be brief and direct; lead with the answer and skip pleasantries.',
  thoughtful: 'Be calm and considered; explain trade-offs when they matter.',
}

/** Read `forwardedProps.persona`; anything malformed yields undefined. */
export function personaFrom(value: unknown): Persona | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { name, tone } = value as { name?: unknown; tone?: unknown }
  if (typeof name !== 'string' || name.trim() === '' || name.length > 60) return undefined
  if (tone !== 'warm' && tone !== 'concise' && tone !== 'thoughtful') return undefined
  return { name: name.trim(), tone }
}

/** The persona section text: who the agent is to the person, and how it speaks. */
export function personaPrompt(persona: Persona): string {
  return [
    `You are ${persona.name}, the person's private agent in xDAN System3 Personal Agent.`,
    'They reach you from their phone or computer. You help with everyday life and work, and you can take on coding work in their repositories, including coordinating expert coding agents.',
    TONES[persona.tone],
    'Reply in the language the person writes in.',
    'Do not volunteer internal details such as file paths, local URLs, sandbox or approval settings; share them only when the person asks about the technical setup or a task needs them.',
    `If asked who or what you are, say you are ${persona.name}, their private agent in xDAN System3 Personal Agent. Do not describe yourself as a harness or as a coding agent.`,
  ].join('\n')
}

/**
 * Shadow the harness identity and deployment persona for one bridge-driven
 * Agent. The sections are scoped to that Agent and read `current` at every
 * assembly, so a persona change from the client applies to the next step.
 * Web and CLI sessions keep the deployment's own prompt.
 * @param agentCtx - the Agent's scoped context.
 * @param current - mutable holder the bridge updates on each run.
 */
export function installPersona(agentCtx: Context, current: { persona: Persona }): void {
  const prompt = agentCtx.systemPrompt
  // Empty scoped sections drop the harness-facing openers for this Agent only:
  // its identity line, the DSH checkout pointer, and the Web GUI orientation,
  // which would tell the model the person is using the DSH browser app.
  prompt.section({ name: 'harness:identity', order: prompt.getSectionOrder('HARNESS_IDENTITY'), text: '' })
  prompt.section({ name: 'harness:source', order: prompt.getSectionOrder('HARNESS_SOURCE'), text: '' })
  prompt.section({ name: 'app:web-surface', order: prompt.getSectionOrder('WEB_SURFACE'), text: '' })
  prompt.section({
    name: PERSONA_PREFIX_SECTION,
    order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    // Client-supplied names are literal text, never prompt variables.
    interpolate: false,
    text: () => personaPrompt(current.persona),
  })
}
