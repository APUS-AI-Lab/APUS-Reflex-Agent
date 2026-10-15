/** Localized copy owned by the dedicated Reflex settings page. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Simplified Chinese settings copy. */
export const zh = {
  verifiedAt: '最近执行验收：{time}',
  nativeSilenceMs: '原生执行无活动预算（毫秒）', recoveryReassessmentMs: '恢复判断最小间隔（毫秒）', retryLimit: '连续重试上限', interruptGraceMs: '中断确认期限（毫秒）', recoveryCooldownMs: '恢复冷却（毫秒）', maxRecoveries: '每个 Goal 恢复上限',
  deploymentSettings: '高级参数（部署管理，只读）', stallMs: '无进展阈值（毫秒）', cooldownMs: '纠偏冷却（毫秒）', maxInterventions: '每个 Goal 干预上限', feedbackMs: '效果观察期（毫秒）', maxCandidates: '单批候选片段上限', maxFragmentChars: '片段字符上限', maxRestoredChars: '恢复字符上限', maxRequestChars: '请求字符预算',
  semanticEnabled: '目标相关性判断：已启用', semanticDisabled: '目标相关性判断：未启用',
  title: 'Reflex 配置', description: '配置决策服务；连接状态与任务能力分别显示',
  unconfigured: '尚未配置决策服务；选择接入方式后保存',
  endpoint: '服务地址', endpointHint: '填写决策服务地址，不能包含密钥或查询参数',
  model: '决策模型', modelHint: '填写服务提供的真实模型 ID',
  protocol: '服务协议', protocolReflex: 'Reflex',
  connectionMode: '接入方式', trialMode: 'APUS Reflex 限时免费端点', customMode: '自定义参数',
  trialHint: '使用预置服务，决策时会发送相关输入、Skill 描述和工作区文件路径',
  effort: '决策强度', effortHint: 'high 或 low',
  timeoutMs: '请求超时（毫秒）', timeoutMsHint: '连接测试和决策请求的等待上限',
  apiKeyEnv: '密钥引用', apiKeyEnvHint: '部署环境密钥不可覆盖；可改用 REFLEX_CUSTOM_API_KEY 保存独立密钥',
  apiKey: 'API Key', apiKeyHint: '留空保留当前密钥；更换密钥时使用新的专用引用名',
  apiKeySet: '已配置密钥', apiKeyUnset: '未配置密钥', clear: '清除已保存的密钥', clearFailed: '密钥未清除，请重试',
  overridden: '用户配置', reset: '恢复部署值', readOnly: '当前部署不允许修改设置', unavailable: 'Reflex 服务尚未加载',
  newCredentialReference: '此引用已有密钥；请为新密钥填写新的专用引用名',
  credentialCheckFailed: '无法确认密钥引用状态，配置未更改，请重试',
  partialSave: '密钥保存结果尚未确认，连接设置可能部分生效。请重新打开并检查。',
  save: '保存', saving: '保存中…', saveFailed: '未能保存全部设置，请检查输入并重试', invalidNumber: '请输入有效值',
  test: '测试连接与真实判断', testing: '正在检测…', untested: '尚未检测当前配置', connected: '真实判断通过',
  failed: '连接测试失败', trialAuthFailed: '预置服务暂不可用，可切换自定义参数', authFailed: '认证失败，请检查 API Key', timeout: '请求超时', modelMissing: '服务未提供该模型',
  decisionRejected: '服务回答未通过真实判断检查', unavailableService: '服务不可用或响应无效', latency: '耗时：{ms} 毫秒',
  draft: '测试仅使用当前草稿，不会保存配置；更改后请重新检测',
  effective: '保存后对新请求生效；正在执行的请求保留原配置', capabilities: '功能配置状态',
  skillSelection: '输入判断与 Skill 选择', entryRouting: '用户入口路由', codexSupervision: 'Codex 长时 Goal 自动纠偏', contextMemory: '会话上下文恢复', workspacePrefetch: '工作区预取',
  notImplemented: '模块未加载', enabled: '已启用', disabled: '未启用', unverified: '执行结果请查看会话记录',
  runtimeUnavailable: '无法读取运行状态', refresh: '刷新能力状态',
  switchTitle: '启用 Reflex 决策', switchOn: '已开启：输入判断、Skill 选择、工作区预取等由 Reflex 在主模型之前完成',
  switchOff: '已关闭：所有请求按原生流程执行，不调用决策服务', switchFailed: '开关状态未保存，请重试',
} satisfies Record<string, string>
/** Settings dictionary keys. */
export type ReflexSettingsKey = keyof typeof zh
/** English settings copy. */
export const en: Record<ReflexSettingsKey, string> = {
  verifiedAt: 'Last execution verification: {time}',
  nativeSilenceMs: 'Native inactivity budget (ms)', recoveryReassessmentMs: 'Recovery assessment interval (ms)', retryLimit: 'Consecutive retry limit', interruptGraceMs: 'Interruption confirmation deadline (ms)', recoveryCooldownMs: 'Recovery cooldown (ms)', maxRecoveries: 'Recoveries per Goal',
  deploymentSettings: 'Advanced limits (deployment-managed, read-only)', stallMs: 'No-progress threshold (ms)', cooldownMs: 'Intervention cooldown (ms)', maxInterventions: 'Interventions per Goal', feedbackMs: 'Feedback window (ms)', maxCandidates: 'Candidates per batch', maxFragmentChars: 'Characters per fragment', maxRestoredChars: 'Restored character limit', maxRequestChars: 'Request character budget',
  semanticEnabled: 'Goal-relevance assessment: enabled', semanticDisabled: 'Goal-relevance assessment: not enabled',
  title: 'Reflex configuration', description: 'Configure the decision service; connectivity and task capabilities are reported separately.',
  unconfigured: 'The decision service is not configured. Choose a connection mode, then save.',
  endpoint: 'Service endpoint', endpointHint: 'Decision service address, without credentials or query parameters.',
  model: 'Decision model', modelHint: 'Use the actual model ID served by the endpoint.',
  protocol: 'Service protocol', protocolReflex: 'Reflex',
  connectionMode: 'Connection mode', trialMode: 'APUS Reflex limited-time free endpoint', customMode: 'Custom parameters',
  trialHint: 'Use the preset service; decisions send relevant input, Skill descriptions and workspace file paths.',
  effort: 'Decision effort', effortHint: 'high or low', timeoutMs: 'Request timeout (ms)', timeoutMsHint: 'Maximum wait for connection tests and decisions.',
  apiKeyEnv: 'Credential reference', apiKeyEnvHint: 'Environment credentials are read-only. Use REFLEX_CUSTOM_API_KEY to save a separate key.',
  apiKey: 'API key', apiKeyHint: 'Leave blank to retain the key. Use a new dedicated reference for a replacement key.', apiKeySet: 'Key configured', apiKeyUnset: 'No key configured',
  clear: 'Clear stored key', clearFailed: 'The key was not cleared. Try again.', overridden: 'User setting', reset: 'Restore deployment value',
  readOnly: 'This deployment does not allow settings changes.', unavailable: 'The Reflex service is not loaded.',
  newCredentialReference: 'This reference already has a key. Use a new dedicated reference for a replacement key.',
  credentialCheckFailed: 'Could not check the credential reference. Configuration was not changed; try again.',
  partialSave: 'The key save is unconfirmed; connection settings may be partially applied. Reopen and check them.',
  save: 'Save', saving: 'Saving…', saveFailed: 'Not all settings were saved. Check the values and try again.', invalidNumber: 'Enter a valid value.',
  test: 'Test connection and real decision', testing: 'Testing…', untested: 'Current settings have not been tested.', connected: 'Real decision passed',
  failed: 'Connection test failed', trialAuthFailed: 'The preset service is unavailable. You can use custom parameters.', authFailed: 'Authentication failed. Check the API key.', timeout: 'Request timed out', modelMissing: 'This model is not served by the endpoint.',
  decisionRejected: 'The answer did not pass the real decision check.', unavailableService: 'The service is unavailable or returned an invalid response.', latency: 'Duration: {ms} ms',
  draft: 'Testing uses the current draft without saving it. Test again after editing.', effective: 'Saved settings apply to new requests; running requests retain their configuration.',
  capabilities: 'Feature configuration', skillSelection: 'Input judgment and Skill selection', entryRouting: 'User entry routing', codexSupervision: 'Codex long-running Goal correction', contextMemory: 'Session context recovery', workspacePrefetch: 'Workspace prefetch',
  notImplemented: 'Module not loaded', enabled: 'Enabled', disabled: 'Disabled', unverified: 'See the conversation for execution results', runtimeUnavailable: 'Runtime status is unavailable.', refresh: 'Refresh capability status',
  switchTitle: 'Enable Reflex decisions', switchOn: 'On: input judgment, Skill selection and workspace prefetch run in Reflex before the main model',
  switchOff: 'Off: every request runs the native path without contacting the decision service', switchFailed: 'The switch was not saved. Try again.',
}
/** Form shell labels from the owning dictionary.
 * @param t - Typed settings dictionary reader.
 * @returns Shared form labels.
 */
export function formLabels(t: (key: ReflexSettingsKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
