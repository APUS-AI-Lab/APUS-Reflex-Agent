/** Locale copy for the Reflex-only Continuum memory preference row. */
export type ContinuumSettingsLocaleKey = 'title' | 'description' | 'error' | 'unavailable' | 'readOnly'
/** English settings copy. */
export const en: Record<ContinuumSettingsLocaleKey, string> = {
  title: 'Continuum memory', description: 'Let Reflex manage Session-backed long-history memory for future turns.', error: 'The deployment did not accept this choice.', unavailable: 'Continuum is not available in this deployment.', readOnly: 'This deployment stores settings read-only.',
}
/** Simplified Chinese settings copy. */
export const zh: Record<ContinuumSettingsLocaleKey, string> = {
  title: 'Continuum 无限记忆', description: '允许 Reflex 为后续回合管理基于 Session 的长历史记忆。', error: '部署没有接受此选择。', unavailable: '当前部署未提供 Continuum。', readOnly: '本部署的设置为只读。',
}
