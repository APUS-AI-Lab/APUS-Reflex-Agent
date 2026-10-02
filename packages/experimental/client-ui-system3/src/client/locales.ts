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
  fallbackTimeout: '判断超时，先由 {model} 回答', fallbackUnavailable: '暂时无法判断，先由 {model} 回答', delegationPreparing: '正在准备委派',
  runStarting: '{provider} 正在启动', runReviewing: '{provider} 已完成，正在复核结果', runMinutes: '{minutes} 分 {seconds} 秒',
  runNote: '最近说明：{note}', alertOvertime: '{provider} 已运行 {duration}，超出预期', alertStalled: '{provider} 已 {duration} 没有新进展',
  alertStarting: '{provider} 启动已超过 {duration}', keepWaiting: '继续等待', stopRun: '停止', stopFailed: '停止失败，请重试',
  delegation: '委派', delegationSuggested: '已建议，等待注入指令', delegationInjected: '已注入指令，等待调用 {tool}', delegationCalled: '已调用 {tool}',
  runRunning: '{provider} 运行中', runCompleted: '{provider} 已完成', runAborted: '{provider} 已中止', runIncomplete: '{provider} 未完成',
  runSeconds: '{seconds} 秒', runCurrent: '当前：{kind}', kindMessage: '消息', kindReasoning: '推理', kindCommand: '命令',
  kindFileChange: '改文件', kindTool: '工具', kindWebSearch: '搜索', kindOther: '其他',
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
  fallbackTimeout: 'Routing timed out; {model} is answering', fallbackUnavailable: 'Routing is unavailable; {model} is answering', delegationPreparing: 'Preparing the hand-off',
  runStarting: '{provider} is starting', runReviewing: '{provider} finished; checking the result', runMinutes: '{minutes} min {seconds} s',
  runNote: 'Latest: {note}', alertOvertime: '{provider} has run for {duration}, longer than expected', alertStalled: '{provider} has made no progress for {duration}',
  alertStarting: '{provider} has been starting for over {duration}', keepWaiting: 'Keep waiting', stopRun: 'Stop', stopFailed: 'Could not stop. Try again.',
  delegation: 'Delegation', delegationSuggested: 'Suggested, instruction pending', delegationInjected: 'Instruction injected, waiting for {tool}', delegationCalled: 'Called {tool}',
  runRunning: '{provider} running', runCompleted: '{provider} finished', runAborted: '{provider} stopped', runIncomplete: '{provider} did not finish',
  runSeconds: '{seconds} s', runCurrent: 'Now: {kind}', kindMessage: 'messages', kindReasoning: 'reasoning', kindCommand: 'commands',
  kindFileChange: 'file changes', kindTool: 'tools', kindWebSearch: 'searches', kindOther: 'other',
} satisfies Record<System3Key, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Real System3 entry and execution feedback. */
    system3: System3Key
  }
}
