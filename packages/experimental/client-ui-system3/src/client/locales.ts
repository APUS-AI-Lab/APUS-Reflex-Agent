import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Product-owned labels for observed System3 states. */
export const zh = {
  title: 'System3', auto: '自动调度', fixed: '固定模型', reset: '恢复自动', resetting: '正在切换…',
  ready: '准备就绪', received: '已接收，正在准备', deciding: '正在选择处理方式',
  adopted: '已选择，等待模型响应', used: '模型已响应', running: '正在执行', settled: '本轮已结束',
  interrupted: '执行未完成', loading: '正在恢复记录', details: '查看执行依据',
  cloud: '决策、采用与响应分别记录', suggestion: '建议模型', adoption: '采用模型', actual: '实际响应模型',
  none: '尚无记录', skill: '专业指令', injected: '已注入', selected: '已选择，尚未注入',
  unchanged: '保留当前处理方式', skillSkipped: '未自动注入专业指令',
  failed: '切换失败，请重试', decisionTime: '决策耗时', milliseconds: '毫秒', historical: '最近一次入口决策',
  routeChosen: '已判断：{route}', routeRetained: '延续上一轮：{route}', continued: '延续上一轮',
  delegation: '委派', delegationSuggested: '已建议，等待注入指令', delegationInjected: '已注入指令，等待调用 {tool}', delegationCalled: '已调用 {tool}',
} satisfies Record<string, string>
/** Typed keys shared by both product locales. */
export type System3Key = keyof typeof zh
/** English product dictionary. */
export const en = {
  title: 'System3', auto: 'Automatic routing', fixed: 'Fixed model', reset: 'Use automatic', resetting: 'Switching…',
  ready: 'Ready', received: 'Received, preparing', deciding: 'Choosing how to proceed',
  adopted: 'Selected, awaiting model response', used: 'Model responded', running: 'Working', settled: 'Turn ended',
  interrupted: 'Execution incomplete', loading: 'Restoring history', details: 'Execution details',
  cloud: 'Decisions, adoption and responses are recorded separately', suggestion: 'Suggested model', adoption: 'Adopted model', actual: 'Responding model',
  none: 'No record yet', skill: 'Specialist instructions', injected: 'Injected', selected: 'Selected, not yet injected',
  unchanged: 'Current route retained', skillSkipped: 'No automatic instructions injected',
  failed: 'Could not switch. Try again.', decisionTime: 'Decision time', milliseconds: 'ms', historical: 'Most recent entry decision',
  routeChosen: 'Routed: {route}', routeRetained: 'Continuing: {route}', continued: 'Continued from the previous turn',
  delegation: 'Delegation', delegationSuggested: 'Suggested, instruction pending', delegationInjected: 'Instruction injected, waiting for {tool}', delegationCalled: 'Called {tool}',
} satisfies Record<System3Key, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Real System3 entry and execution feedback. */
    system3: System3Key
  }
}
