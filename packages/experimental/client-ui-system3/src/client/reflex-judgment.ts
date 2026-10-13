/** Localized feedback from recorded Reflex judgments, without inferring task execution. */
import type { System3SkillView } from '@deepseek-ai/dsh-experimental-system3/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { System3Key } from './locales.ts'

const INTENTS = {
  conversation: 'judgmentConversation', retrieval: 'judgmentRetrieval', research: 'judgmentResearch',
  creation: 'judgmentCreation', action: 'judgmentAction', uncertain: 'judgmentUncertain',
} satisfies Record<NonNullable<System3SkillView['intent']>, System3Key>

/** Describe an observed judgment; absence of one never becomes a fabricated success.
 * @param skill - Recorded input classification and optional Skill recommendation.
 * @param t - Product dictionary.
 * @returns Compact judgment or explicit fallback; undefined for unrelated historical outcomes.
 */
export function reflexJudgmentText(skill: System3SkillView | null | undefined, t: TranslateNS<'system3'>): string | undefined {
  if (skill === null || skill === undefined) return undefined
  const judgment = skill.selected !== null && skill.outcome === 'selected'
    ? t(skill.injected ? 'judgmentSkillLoaded' : 'judgmentSkillSelected', { skill: skill.selected })
    : skill.intent !== undefined ? t(INTENTS[skill.intent]) : undefined
  if (judgment !== undefined) return t('judgmentResult', { judgment, ms: String(Math.max(0, Math.round(skill.elapsedMs))) })
  if (skill.outcome === 'timeout' || skill.outcome === 'deadline') return t('judgmentTimeout')
  if (skill.outcome === 'provider-unavailable' || skill.outcome === 'missing-credential') return t('judgmentNotConfigured')
  if (skill.outcome === 'input-too-large') return t('judgmentInputTooLarge')
  if (skill.outcome === 'aborted' || skill.outcome === 'cancelled') return undefined
  return t('judgmentUnavailable')
}
