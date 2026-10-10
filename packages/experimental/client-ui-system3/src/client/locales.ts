import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Product-owned labels for observed System3 states. */
export const zh = {
  title: 'APUS Reflex Harness', auto: '自动调度', fixed: '固定模型', reset: '恢复自动', resetting: '正在切换…',
  ready: '准备就绪', received: '已接收，正在准备', deciding: '正在选择处理方式',
  adopted: '已选择，等待模型响应', used: '模型已响应', running: '正在执行', settled: '本轮已结束',
  interrupted: '执行未完成', loading: '正在恢复记录', details: '查看执行依据',
  cloud: '决策、采用与响应分别记录', suggestion: '建议模型', adoption: '采用模型', actual: '实际响应模型',
  none: '尚无记录', skill: '专业指令', injected: '已注入', selected: '已选择，尚未注入',
  unchanged: '保留当前处理方式', skillSkipped: '未自动注入专业指令',
  failed: '切换失败，请重试', decisionTime: '决策耗时', milliseconds: '毫秒', historical: '最近一次入口决策',
  routeChosen: '已判断：{route}', routeAvoided: '已避开较慢的线路：{routes}', composerDelegated: '已交给 {provider}', composerDelegating: '正在交给子任务',
  composerDelegationHint: '这项任务已委派出去；右侧的模型负责协调和核对结果', routeRetained: '延续上一轮：{route}', continued: '延续上一轮',
  fallbackTimeout: '判断超时，先由 {model} 回答', fallbackUnavailable: '暂时无法判断，先由 {model} 回答', delegationPreparing: '正在准备委派',
  runStarting: '{provider} 正在启动', runReviewing: '{provider} 已完成，正在复核结果', runMinutes: '{minutes} 分 {seconds} 秒',
  runNote: '最近说明：{note}', alertOvertime: '{provider} 已运行 {duration}，超出预期', alertStalled: '{provider} 已 {duration} 没有新进展',
  alertStarting: '{provider} 启动已超过 {duration}', keepWaiting: '继续等待', stopRun: '停止', stopFailed: '停止失败，请重试',
  steerOpen: '补充说明', steerLabel: '补充说明', steerPlaceholder: '告诉它要调整什么，例如：先让测试通过，不用改 README',
  steerSend: '发送', steerSending: '发送中', steerFailed: '没有送达，任务可能已结束', steerSent: '已补充（{duration}）：{text}',
  delegation: '委派', delegationSuggested: '已建议，等待注入指令', delegationInjected: '已注入指令，等待调用 {tool}', delegationCalled: '已调用 {tool}',
  runRunning: '{provider} 运行中', runCompleted: '{provider} 已完成', runAborted: '{provider} 已中止', runIncomplete: '{provider} 未完成',
  runSeconds: '{seconds} 秒', runCurrent: '当前：{kind}', kindMessage: '消息', kindReasoning: '推理', kindCommand: '命令',
  kindFileChange: '改文件', kindTool: '工具', kindWebSearch: '搜索', kindOther: '其他',
  noticeRepeatedError: '{subject} 已连续 {count} 次以同样的错误失败', noticeFailedAttempts: '本轮已有 {count} 次操作失败',
  noticeNoProgress: '最近 {count} 步没有新的修改或通过的验证', noticeMissingEvidence: '已修改文件，但还没有运行通过的测试或构建',
  noticeDelegateFailures: '{subject} 已有 {count} 条命令失败', noticeOther: '过程监督提示', noticeAdvised: '已提醒模型调整做法',
  taskFrame: '任务卡 · 已记下 {count} 条要求', taskGoal: '任务：{text}', taskItem: '· {text}',
  interjectionSteered: '已把你刚才补充的要求插入正在进行的这一轮',
} satisfies Record<string, string>
/** Typed keys shared by both product locales. */
export type System3Key = keyof typeof zh
/** English product dictionary. */
export const en = {
  title: 'APUS Reflex Harness', auto: 'Automatic routing', fixed: 'Fixed model', reset: 'Use automatic', resetting: 'Switching…',
  ready: 'Ready', received: 'Received, preparing', deciding: 'Choosing how to proceed',
  adopted: 'Selected, awaiting model response', used: 'Model responded', running: 'Working', settled: 'Turn ended',
  interrupted: 'Execution incomplete', loading: 'Restoring history', details: 'Execution details',
  cloud: 'Decisions, adoption and responses are recorded separately', suggestion: 'Suggested model', adoption: 'Adopted model', actual: 'Responding model',
  none: 'No record yet', skill: 'Specialist instructions', injected: 'Injected', selected: 'Selected, not yet injected',
  unchanged: 'Current route retained', skillSkipped: 'No automatic instructions injected',
  failed: 'Could not switch. Try again.', decisionTime: 'Decision time', milliseconds: 'ms', historical: 'Most recent entry decision',
  routeChosen: 'Routed: {route}', routeAvoided: 'avoided slow routes: {routes}', composerDelegated: 'Handed to {provider}', composerDelegating: 'Handing off',
  composerDelegationHint: 'This task is delegated; the model on the right coordinates and checks the result', routeRetained: 'Continuing: {route}', continued: 'Continued from the previous turn',
  fallbackTimeout: 'Routing timed out; {model} is answering', fallbackUnavailable: 'Routing is unavailable; {model} is answering', delegationPreparing: 'Preparing the hand-off',
  runStarting: '{provider} is starting', runReviewing: '{provider} finished; checking the result', runMinutes: '{minutes} min {seconds} s',
  runNote: 'Latest: {note}', alertOvertime: '{provider} has run for {duration}, longer than expected', alertStalled: '{provider} has made no progress for {duration}',
  alertStarting: '{provider} has been starting for over {duration}', keepWaiting: 'Keep waiting', stopRun: 'Stop', stopFailed: 'Could not stop. Try again.',
  steerOpen: 'Add guidance', steerLabel: 'Guidance', steerPlaceholder: 'Tell it what to change, for example: make the tests pass first, skip the README',
  steerSend: 'Send', steerSending: 'Sending', steerFailed: 'Not delivered. The task may have ended.', steerSent: 'Added at {duration}: {text}',
  delegation: 'Delegation', delegationSuggested: 'Suggested, instruction pending', delegationInjected: 'Instruction injected, waiting for {tool}', delegationCalled: 'Called {tool}',
  runRunning: '{provider} running', runCompleted: '{provider} finished', runAborted: '{provider} stopped', runIncomplete: '{provider} did not finish',
  runSeconds: '{seconds} s', runCurrent: 'Now: {kind}', kindMessage: 'messages', kindReasoning: 'reasoning', kindCommand: 'commands',
  kindFileChange: 'file changes', kindTool: 'tools', kindWebSearch: 'searches', kindOther: 'other',
  noticeRepeatedError: '{subject} failed {count} times with the same error', noticeFailedAttempts: '{count} actions failed this turn',
  noticeNoProgress: 'No new changes or passing checks in the last {count} steps', noticeMissingEvidence: 'Files changed, but no test or build has passed yet',
  noticeDelegateFailures: '{subject} has {count} failed commands', noticeOther: 'Process notice', noticeAdvised: 'The model was asked to change course',
  taskFrame: 'Task card · requirements kept: {count}', taskGoal: 'Task: {text}', taskItem: '· {text}',
  interjectionSteered: 'Your latest requirement was added to the running turn',
} satisfies Record<System3Key, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Real System3 entry and execution feedback. */
    system3: System3Key
  }
}
