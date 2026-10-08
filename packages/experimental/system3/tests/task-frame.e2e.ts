/** Task-frame judgements against the deployed Jev on a labelled set; skipped without JEV_API_KEY. */
import { readFileSync, writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterAll, describe, expect, it } from 'vitest'
import Jev from '../../apus-dsh-jev-plugin/src/index.ts'
import { runSystem3Decision } from '../src/decision-kernel.ts'
import { system3TaskFrameDecision } from '../src/task-frame.ts'

const deployment = readFileSync(new URL('../../../../deploy/system3/runtime.patch.yml', import.meta.url), 'utf8')
const endpoint = /endpoint: (\S+)/.exec(deployment)?.[1]
const jevModel = /model: (APUS-\S+)/.exec(deployment)?.[1]
const yes = Number(/taskFrame:[\s\S]*?yes: (\S+)/.exec(deployment)?.[1])
const no = Number(/taskFrame:[\s\S]*?\bno: (\S+)/.exec(deployment)?.[1])

type Label = 'new-task' | 'requirement' | 'acceptance' | 'correction' | 'none'
const LEDGER = '帮我给记账命令行工具加一个按月汇总的命令'
const FRONTEND = '把登录页改成支持手机号验证码登录'
/** The current task, the person's new message, and what it is; a second label is also accepted. */
const CASES: readonly { readonly goal: string; readonly message: string; readonly label: Label; readonly also?: Label }[] = [
  { goal: LEDGER, message: '函数名统一用 snake_case', label: 'requirement' },
  { goal: LEDGER, message: '别动 README.md', label: 'requirement' },
  { goal: LEDGER, message: '做完之后 pytest 必须全部通过', label: 'acceptance' },
  { goal: LEDGER, message: '输出要按金额从大到小排序', label: 'requirement', also: 'acceptance' },
  { goal: LEDGER, message: '不对，我说的是按月，不是按周', label: 'correction' },
  { goal: LEDGER, message: '刚才那个文件放错目录了，应该放到 src/commands 下', label: 'correction', also: 'requirement' },
  { goal: LEDGER, message: '谢谢，辛苦了', label: 'none' },
  { goal: LEDGER, message: '这个命令大概要多久能写完？', label: 'none' },
  { goal: LEDGER, message: '顺便问一下，Python 的 dataclass 和 namedtuple 有什么区别？', label: 'none' },
  { goal: LEDGER, message: '好了这个先放一边，帮我写一封请假邮件', label: 'new-task' },
  { goal: LEDGER, message: '换个事：把 nginx 配置里的超时改成 60 秒', label: 'new-task' },
  { goal: LEDGER, message: '汇总结果要能导出成 CSV', label: 'requirement', also: 'acceptance' },
  { goal: LEDGER, message: '完成标准是 ledger summary --month 2026-09 能输出正确的总额', label: 'acceptance' },
  { goal: LEDGER, message: '提交前跑一下 ruff，必须零告警', label: 'acceptance', also: 'requirement' },
  { goal: LEDGER, message: '不要引入新的第三方依赖', label: 'requirement' },
  { goal: LEDGER, message: '你刚才把测试删了？不行，恢复回来', label: 'correction' },
  { goal: LEDGER, message: '继续', label: 'none' },
  { goal: LEDGER, message: '看起来不错', label: 'none' },
  { goal: LEDGER, message: '日志里不要打印用户的银行卡号', label: 'requirement' },
  { goal: LEDGER, message: '提交信息用中文写', label: 'requirement' },
  { goal: LEDGER, message: '现在帮我查一下明天北京的天气', label: 'new-task' },
  { goal: LEDGER, message: '能不能把刚才的实现解释一下？', label: 'none' },
  { goal: LEDGER, message: '这里应该用 Decimal 而不是 float，金额会有精度问题', label: 'correction', also: 'requirement' },
  { goal: LEDGER, message: '所有新函数都要有类型注解和 docstring', label: 'requirement' },
  { goal: LEDGER, message: '等 CI 全绿了再告诉我完成', label: 'acceptance' },
  { goal: LEDGER, message: '这个方案太复杂了，简单点，一个函数就够', label: 'correction' },
  { goal: LEDGER, message: '我们另起一个任务：给项目加 GitHub Actions', label: 'new-task' },
  { goal: LEDGER, message: '嗯', label: 'none' },
  { goal: LEDGER, message: 'data/ledger.csv 只能读，不能修改', label: 'requirement' },
  { goal: LEDGER, message: '性能要求：一万条记录汇总要在 1 秒内', label: 'acceptance', also: 'requirement' },
  { goal: FRONTEND, message: '验证码 60 秒内只能发一次', label: 'requirement', also: 'acceptance' },
  { goal: FRONTEND, message: '按钮颜色用品牌橙色，别自己发明颜色', label: 'requirement' },
  { goal: FRONTEND, message: '在 iPhone SE 宽度下也不能出现横向滚动条才算完成', label: 'acceptance' },
  { goal: FRONTEND, message: '我不是要删掉密码登录，两种都要保留', label: 'correction', also: 'requirement' },
  { goal: FRONTEND, message: '你用的是哪个短信服务商？', label: 'none' },
  { goal: FRONTEND, message: '帮我把上周的周报整理一下', label: 'new-task' },
]
const CRAWLER = '帮我写一个爬取豆瓣电影 Top250 的 Python 脚本'
const SITE = '把公司官网首页的轮播图换成视频背景'
/** Held-out cases labelled before their first run; the questions were not changed after it. */
const HELD_OUT: typeof CASES = [
  { goal: CRAWLER, message: '请求之间至少间隔 2 秒', label: 'requirement' },
  { goal: CRAWLER, message: '结果存成 JSON，不要存 CSV', label: 'requirement' },
  { goal: CRAWLER, message: '能跑完 250 条且没有重复才算完成', label: 'acceptance' },
  { goal: CRAWLER, message: '你怎么把 User-Agent 写死了，改成随机的', label: 'correction', also: 'requirement' },
  { goal: CRAWLER, message: 'requests 和 httpx 哪个好？', label: 'none' },
  { goal: CRAWLER, message: '帮我订一张明天去上海的高铁票', label: 'new-task' },
  { goal: CRAWLER, message: '好的', label: 'none' },
  { goal: SITE, message: '视频不能超过 5MB', label: 'requirement', also: 'acceptance' },
  { goal: SITE, message: '移动端不要自动播放', label: 'requirement' },
  { goal: SITE, message: 'Lighthouse 性能分不低于 90 才能上线', label: 'acceptance' },
  { goal: SITE, message: '不对，我要的是首页，你改的是关于我们页面', label: 'correction' },
  { goal: SITE, message: '给我讲讲 CSS 的 object-fit 是什么意思', label: 'none' },
  { goal: SITE, message: '先不弄这个了，帮我起草一份年终总结', label: 'new-task' },
  { goal: SITE, message: '辛苦啦，今天就到这', label: 'none' },
  { goal: SITE, message: '这个视频要静音播放', label: 'requirement' },
]
const TRANSLATE = '帮我把这篇英文技术文章翻译成中文'
const ORDERS = '给订单服务加一个按用户 ID 查询订单的接口'
const TRIP = '帮我规划一下下周去杭州的三天行程'
/** Second held-out set, labelled before its only run, after the questions above were final. */
const HELD_OUT_2: typeof CASES = [
  { goal: TRANSLATE, message: '术语保留英文原文，括号里给中文', label: 'requirement' },
  { goal: TRANSLATE, message: '代码块不要翻译', label: 'requirement' },
  { goal: TRANSLATE, message: '翻完通读一遍，确保没有漏段才算完', label: 'acceptance' },
  { goal: TRANSLATE, message: '你把 latency 译成了“潜伏期”，这里应该是“延迟”', label: 'correction', also: 'requirement' },
  { goal: TRANSLATE, message: '“幂等”这个词到底什么意思？', label: 'none' },
  { goal: TRANSLATE, message: '帮我把客厅的灯打开', label: 'new-task' },
  { goal: TRANSLATE, message: '先这样吧，明天再说', label: 'none' },
  { goal: ORDERS, message: '接口路径用 /v2/orders，不要用 v1', label: 'requirement' },
  { goal: ORDERS, message: '响应时间 P99 要小于 200ms', label: 'acceptance', also: 'requirement' },
  { goal: ORDERS, message: '单元测试覆盖率不能低于 80%', label: 'acceptance', also: 'requirement' },
  { goal: ORDERS, message: '你把字段名写成 userId 了，我们统一用 user_id', label: 'correction', also: 'requirement' },
  { goal: ORDERS, message: '这个接口要不要加缓存？你怎么看', label: 'none' },
  { goal: ORDERS, message: '把这个接口的 SQL 换成参数化查询，防注入', label: 'requirement', also: 'correction' },
  { goal: ORDERS, message: '好，继续吧', label: 'none' },
  { goal: TRIP, message: '预算控制在 3000 元以内', label: 'requirement', also: 'acceptance' },
  { goal: TRIP, message: '不要安排爬山，我膝盖不好', label: 'requirement' },
  { goal: TRIP, message: '你排的第二天太赶了，减少两个景点', label: 'correction' },
  { goal: TRIP, message: '每天的行程都要留出午休时间', label: 'requirement' },
  { goal: TRIP, message: '杭州现在天气怎么样？', label: 'none' },
  { goal: TRIP, message: '帮我写一段 Python 冒泡排序', label: 'new-task' },
]
const EXPORT = '给订单服务加一个导出 Excel 的接口'
const SPEED = '把首页的加载速度优化到 2 秒以内'
/**
 * Messages typed while a turn runs; a kept message moves into that turn, the rest stay queued.
 * Labelled before the only run of this set, with the questions unchanged from held-out-3.
 */
const INTERJECTION: typeof CASES = [
  { goal: EXPORT, message: '等等，先别跑全量测试，只跑 orders 相关的', label: 'correction', also: 'requirement' },
  { goal: EXPORT, message: '对了，导出的文件名要带上日期', label: 'requirement' },
  { goal: EXPORT, message: '用 openpyxl 就行，别引入 pandas', label: 'requirement' },
  { goal: EXPORT, message: '刚才那个接口路径写错了，应该是 /orders/export', label: 'correction' },
  { goal: EXPORT, message: '导出 1 万行要在 3 秒内完成', label: 'acceptance', also: 'requirement' },
  { goal: EXPORT, message: '你现在跑到哪一步了？', label: 'none' },
  { goal: EXPORT, message: 'openpyxl 和 xlsxwriter 有啥区别？', label: 'none' },
  { goal: EXPORT, message: '辛苦了', label: 'none' },
  { goal: EXPORT, message: '等你忙完帮我看下今天的邮件', label: 'new-task' },
  { goal: SPEED, message: '图片别压得太狠，画质要保留', label: 'requirement' },
  { goal: SPEED, message: '不要改动后端接口', label: 'requirement' },
  { goal: SPEED, message: '你把 lazy load 加到首屏图片上了，首屏不要懒加载', label: 'correction', also: 'requirement' },
  { goal: SPEED, message: 'Lighthouse 跑三次取平均才算数', label: 'acceptance' },
  { goal: SPEED, message: '这个优化大概能提升多少？', label: 'none' },
  { goal: SPEED, message: '顺便帮我写个周报', label: 'new-task' },
  { goal: SPEED, message: 'ok', label: 'none' },
  { goal: SPEED, message: '我看到你删了 analytics 脚本，那个必须保留', label: 'correction', also: 'requirement' },
  { goal: SPEED, message: 'CDN 用阿里云的，不要换', label: 'requirement' },
  { goal: SPEED, message: '今天先到这', label: 'none' },
]
const SIGNUP = '把用户注册流程改成支持邮箱验证码'
const MD2PDF = '写一个把 Markdown 转成 PDF 的命令行工具'
/**
 * Fourth held-out set after the interrupt question was added: interruptions, farewells, and stop-and-switch messages.
 * Labelled before its only run; interruptions of the current task are labelled as corrections.
 */
const HELD_OUT_4: typeof CASES = [
  { goal: SIGNUP, message: '等一下，先别提交代码，我还要再看看', label: 'correction', also: 'requirement' },
  { goal: SIGNUP, message: '停一下，别删数据库里的测试数据', label: 'correction', also: 'requirement' },
  { goal: SIGNUP, message: '先不要跑迁移脚本', label: 'correction', also: 'requirement' },
  { goal: SIGNUP, message: '验证码有效期设为 5 分钟', label: 'requirement' },
  { goal: SIGNUP, message: '你把发件人写成个人邮箱了，要用 noreply@ 开头的地址', label: 'correction', also: 'requirement' },
  { goal: SIGNUP, message: '晚安，明天继续', label: 'none' },
  { goal: SIGNUP, message: '先这样，下次再说', label: 'none' },
  { goal: SIGNUP, message: '先别弄注册了，帮我订个明天下午的会议室', label: 'new-task' },
  { goal: SIGNUP, message: '停，帮我看看生产服务器为什么挂了', label: 'new-task' },
  { goal: SIGNUP, message: '验证码是 6 位数字吗？', label: 'none' },
  { goal: MD2PDF, message: '先别装 LaTeX，太大了，换个轻量方案', label: 'correction', also: 'requirement' },
  { goal: MD2PDF, message: '别用 Node 写，用 Python', label: 'requirement', also: 'correction' },
  { goal: MD2PDF, message: '能处理带图片的 Markdown 才算完成', label: 'acceptance' },
  { goal: MD2PDF, message: '哈哈不错', label: 'none' },
  { goal: MD2PDF, message: '这个工具就叫 md2pdf', label: 'requirement' },
  { goal: MD2PDF, message: '帮我把下周的会议纪要整理一下', label: 'new-task' },
]
const ROOMS = '帮我做一个公司内部用的会议室预订小程序'
const SALES = '帮我分析一下这份销售数据，找出下滑最严重的三个区域'
const PRD = '帮我写一份产品需求文档，主题是会员积分系统'
/** Third held-out set, labelled before its only run; it decided whether the questions ship. */
const HELD_OUT_3: typeof CASES = [
  { goal: ROOMS, message: '只允许公司邮箱登录', label: 'requirement' },
  { goal: ROOMS, message: '同一时间段不能重复预订，这是硬性要求', label: 'requirement', also: 'acceptance' },
  { goal: ROOMS, message: '能在 iOS 和安卓上都跑通才算交付', label: 'acceptance' },
  { goal: ROOMS, message: '你把预订时长上限写成 2 小时了，应该是 4 小时', label: 'correction', also: 'requirement' },
  { goal: ROOMS, message: '小程序和 H5 有什么区别？', label: 'none' },
  { goal: ROOMS, message: '今天先到这里，拜拜', label: 'none' },
  { goal: ROOMS, message: '帮我给张经理发个微信，说会议改到三点', label: 'new-task' },
  { goal: ROOMS, message: '嗯嗯好的', label: 'none' },
  { goal: SALES, message: '只看 2026 年第三季度的数据', label: 'requirement' },
  { goal: SALES, message: '结论要配图表', label: 'requirement', also: 'acceptance' },
  { goal: SALES, message: '你用的是销售额，我要的是销量', label: 'correction', also: 'requirement' },
  { goal: SALES, message: '口径和财务报表保持一致', label: 'requirement' },
  { goal: SALES, message: '顺便说下，Excel 的数据透视表怎么用？', label: 'none' },
  { goal: SALES, message: '帮我把这个 PPT 的字体统一成微软雅黑', label: 'new-task' },
  { goal: SALES, message: '晚安', label: 'none' },
  { goal: PRD, message: '篇幅控制在 5 页以内', label: 'requirement', also: 'acceptance' },
  { goal: PRD, message: '要包含竞品对比章节才算完整', label: 'acceptance' },
  { goal: PRD, message: '积分不能兑换现金，这点要写清楚', label: 'requirement' },
  { goal: PRD, message: '先别写了，帮我查一下明天的汇率', label: 'new-task' },
  { goal: PRD, message: '写得挺好，继续', label: 'none' },
]

const contexts: Context[] = []
afterAll(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

describe.skipIf(!process.env.JEV_API_KEY)('System3 task frame against the deployed Jev', { retry: 0 }, () => {
  it('keeps the labelled requirements, resets on new tasks, and leaves the rest out', { timeout: 600_000 }, async () => {
    if (endpoint === undefined || jevModel === undefined || !Number.isFinite(yes) || !Number.isFinite(no)) {
      throw new Error('deploy/system3/runtime.patch.yml no longer declares the Jev endpoint, model and taskFrame thresholds')
    }
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Jev, { endpoint, model: jevModel, apiKeyEnv: 'JEV_API_KEY', effort: 'high', timeoutMs: 15000 })
    const agent = await ctx.agentLoop.create(SessionId('task-frame-e2e'), { provider: 'none', model: 'none' })
    const settings = { mode: 'active' as const, yes, no, deadlineMs: 15000 }
    const shared = { policy: { mode: 'controlled' as const, approvedRemoteIds: ['jev'], approvedRemoteDataClasses: ['workspace' as const] },
      options: { routeId: 'jev', executionDomain: 'network' as const, effort: 'high' as const }, dataClasses: ['workspace' as const] }
    const results = []
    const sets: Readonly<Record<string, typeof CASES>> = { 'held-out': HELD_OUT, 'held-out-2': HELD_OUT_2,
      'held-out-3': HELD_OUT_3, interjection: INTERJECTION, 'held-out-4': HELD_OUT_4 }
    const set = sets[process.env.SYSTEM3_TASK_FRAME_SET ?? ''] ?? CASES
    for (const sample of set) {
      const result = await runSystem3Decision(ctx, shared, system3TaskFrameDecision, settings, agent,
        { goal: sample.goal, message: sample.message }, AbortSignal.timeout(30_000))
      const answers = result.judgement.response?.answers ?? {}
      const nouls = Object.fromEntries(['request', 'requirement', 'acceptance', 'interrupt', 'correction'].map((key) => {
        const answer = answers[key]
        return [key, answer?.type === 'noul' ? Math.round(answer.noul * 1000) / 1000 : -1]
      }))
      const chosen = answers.intent?.type === 'choice' ? answers.intent : undefined
      const intent = chosen === undefined ? null
        : { choice: chosen.choice, probability: Math.round((chosen.probabilities[chosen.choice] ?? 0) * 1000) / 1000 }
      results.push({ ...sample, outcome: result.outcome, reason: result.judgement.reason, intent, nouls,
        elapsedMs: result.judgement.elapsedMs })
    }
    const kept = (label: Label | undefined) => label === 'requirement' || label === 'acceptance' || label === 'correction'
    const shouldKeep = results.filter(result => kept(result.label))
    const didKeep = results.filter(result => result.outcome === 'add')
    const shouldReset = results.filter(result => result.label === 'new-task')
    const didReset = results.filter(result => result.outcome === 'new-task')
    const ratio = (part: number, whole: number) => whole === 0 ? 1 : part / whole
    const report = {
      yes, no,
      keep: { precision: ratio(didKeep.filter(result => kept(result.label)).length, didKeep.length),
        recall: ratio(shouldKeep.filter(result => result.outcome === 'add').length, shouldKeep.length) },
      reset: { precision: ratio(didReset.filter(result => result.label === 'new-task').length, didReset.length),
        recall: ratio(shouldReset.filter(result => result.outcome === 'new-task').length, shouldReset.length) },
      elapsedMs: results.map(result => result.elapsedMs).sort((a, b) => a - b),
      results,
    }
    if (process.env.SYSTEM3_TASK_FRAME_REPORT) writeFileSync(process.env.SYSTEM3_TASK_FRAME_REPORT, `${JSON.stringify(report, null, 2)}\n`)
    expect(report.keep.precision).toBeGreaterThanOrEqual(0.9)
    expect(report.keep.recall).toBeGreaterThanOrEqual(0.8)
    // A wrong reset discards the person's requirements, a missed one only keeps them longer, so precision comes first.
    expect(report.reset.precision).toBeGreaterThanOrEqual(0.9)
    expect(report.reset.recall).toBeGreaterThanOrEqual(0.6)
  })
})
