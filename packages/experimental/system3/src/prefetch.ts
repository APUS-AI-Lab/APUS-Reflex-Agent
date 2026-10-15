/**
 * Reflex prefetch: when a person's text input enters a step, System3 lists the read-only workspace facts that input
 * could need (pending changes, the file list, the README, the manifest, files the input names, matching lines, or every
 * source file of a small project), runs all of them in the read-only sandbox while one Jev request judges which ones the
 * input needs, and hands the needed outputs to the main model in the same step. The model then starts from the facts
 * instead of gathering them through serial tool calls.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { System3DataClass, System3PrivacyPolicy } from '@deepseek-ai/dsh-experimental-system3-policy'
import { noulVerdict, runSystem3Decision, validateSystem3DecisionSettings, type System3DecisionContext,
  type System3DecisionSettings, type System3DecisionSpec } from './decision-kernel.ts'
import type { System3JevOptions } from './decisions.ts'

/** Mode, thresholds, and size limits of Reflex prefetch; deployment-owned. */
export interface System3PrefetchConfig extends System3DecisionSettings {
  /** Data classes of the input and workspace names sent to Jev, checked against the privacy policy. */
  readonly sessionDataClasses: readonly System3DataClass[]
  /** Bytes of one prefetched output shown to the model; a longer output is cut and marked. */
  readonly maxItemBytes: number
  /** Bytes of all prefetched outputs of one input together; later outputs past it are left out and named. */
  readonly maxTotalBytes: number
  /** A project with at most this many tracked files offers its complete sources as one prefetch. */
  readonly maxSourceFiles: number
  /** Most input words searched for in the project. */
  readonly maxSearchTerms: number
  /** Deadline of each read-only command, in milliseconds. */
  readonly commandTimeoutMs: number
}

/** Attribution of the message that carries prefetched workspace facts. */
export interface System3PrefetchSource {
  readonly kind: 'system3-prefetch'
  /** Ids of the prefetched facts the message carries, in order. */
  readonly items: readonly string[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Read-only workspace facts System3 prefetched for the person's input before the step's model request.
     * Readers preserve the content without this producer.
     * @persistenceAttribution
     */
    'system3-prefetch': System3PrefetchSource
  }
}

/** One read-only workspace fact the input may need. */
export interface System3PrefetchCandidate {
  /** Stable id, recorded in the message source. */
  readonly id: string
  /** What the fact contains, as Jev reads it. */
  readonly description: string
  /** The command shown to the main model above the output. */
  readonly label: string
  /** Shell command run in the read-only sandbox. */
  readonly command: string
}

/** What the workspace offers, found by one discovery command. */
export interface System3WorkspaceFacts {
  readonly git: boolean
  readonly trackedFiles: number
  readonly readme?: string
  readonly manifest?: string
  /** Relative paths named in the input that exist as files. */
  readonly mentioned: readonly string[]
}

interface PrefetchInput {
  readonly input: string
  readonly candidates: readonly System3PrefetchCandidate[]
}

const README_NAMES = ['README.md', 'README', 'readme.md', 'README.rst', 'README.txt']
const MANIFEST_NAMES = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile']
/** Git without hooks or fsmonitor; diffs also pass --no-ext-diff --no-textconv, so no repository-configured program runs. */
const GIT = 'git --no-pager -c core.fsmonitor=false -c core.hooksPath=/dev/null'
/** Words that name no project fact, so searching for them finds nothing useful. */
const QUESTION_WORDS = new Set(['what', 'which', 'where', 'when', 'does', 'this', 'that', 'with', 'from', 'have', 'many', 'much', 'most',
  'answer', 'sentence', 'only', 'project', 'please', 'tell', 'show', 'list', 'write', 'line', 'lines', 'file', 'files', 'code', 'need',
  'there', 'their', 'about', 'into', 'than', 'then', 'them', 'they', 'will', 'would', 'could', 'should', 'nothing', 'else', 'mine'])

/**
 * Quote a value as one POSIX shell word.
 * @param value - Any text.
 * @returns The text in single quotes, with embedded single quotes escaped.
 */
export function shellWord(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * Relative paths the input names: words with a directory separator or a file extension, without `..` segments, absolute
 * roots, or shell-special characters.
 * @param input - The person's text input.
 * @returns Distinct candidate paths in input order.
 */
export function mentionedPaths(input: string): string[] {
  // A path starts at a word boundary that no path character precedes, so `/etc/x` and `../x` yield no relative tail.
  const found = input.match(/(?<![\w./@-])(?:[\w.@-]*[\w@-](?:\/[\w.@-]+)+|[\w@-][\w.@-]*\.[A-Za-z][A-Za-z0-9]{0,7}\b)/gu) ?? []
  return [...new Set(found.map(path => path.replace(/[.,;:]+$/u, '')))]
    .filter(path => !path.startsWith('/') && !path.split('/').includes('..') && !/^\d+(?:\.\d+)+$/u.test(path))
}

/**
 * Words of the input worth searching for in the project: identifiers and words of at least four letters that are not
 * question words, longest first.
 * @param input - The person's text input.
 * @param limit - Most words returned.
 * @returns Distinct search words.
 */
export function searchTerms(input: string, limit: number): string[] {
  const words = input.match(/[A-Za-z_][A-Za-z0-9_]{3,}/gu) ?? []
  return [...new Set(words.filter(word => !QUESTION_WORDS.has(word.toLowerCase())))]
    .sort((a, b) => b.length - a.length).slice(0, limit)
}

/**
 * The shell command that reports what the workspace offers, one `key=value` line per fact.
 * @param mentioned - Relative paths the input names.
 * @returns A read-only shell command.
 */
export function discoveryCommand(mentioned: readonly string[]): string {
  return [
    `if ${GIT} rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo git=1; echo files=$(${GIT} ls-files | wc -l); fi`,
    `for f in ${README_NAMES.map(shellWord).join(' ')}; do if [ -f "$f" ]; then echo "readme=$f"; break; fi; done`,
    `for f in ${MANIFEST_NAMES.map(shellWord).join(' ')}; do if [ -f "$f" ]; then echo "manifest=$f"; break; fi; done`,
    ...mentioned.map(path => `if [ -f ${shellWord(path)} ]; then printf 'mentioned=%s\\n' ${shellWord(path)}; fi`),
  ].join('\n')
}

/**
 * Parse the output of {@link discoveryCommand}.
 * @param output - The command's stdout.
 * @returns The workspace facts it reports.
 */
export function parseWorkspaceFacts(output: string): System3WorkspaceFacts {
  const lines = output.split('\n').map(line => line.trim()).filter(line => line.includes('='))
  const value = (key: string): string | undefined => lines.find(line => line.startsWith(`${key}=`))?.slice(key.length + 1)
  const readme = value('readme')
  const manifest = value('manifest')
  return {
    git: value('git') === '1', trackedFiles: Number(value('files') ?? '0'),
    ...readme === undefined ? {} : { readme }, ...manifest === undefined ? {} : { manifest },
    mentioned: lines.filter(line => line.startsWith('mentioned=')).map(line => line.slice('mentioned='.length)),
  }
}

/**
 * The read-only facts one input may need in a workspace, in the order the model receives them.
 * @param input - The person's text input.
 * @param facts - What the workspace offers.
 * @param config - Size limits of prefetch.
 * @returns Candidates, at most 16 so one Jev request judges all of them.
 */
export function prefetchCandidates(input: string, facts: System3WorkspaceFacts,
  config: Pick<System3PrefetchConfig, 'maxItemBytes' | 'maxSourceFiles' | 'maxSearchTerms'>): System3PrefetchCandidate[] {
  const cut = (command: string): string => `{ ${command}; } 2>&1 | head -c ${String(config.maxItemBytes + 1)}`
  const candidates: System3PrefetchCandidate[] = []
  if (facts.git) {
    candidates.push({ id: 'changes', description: '工作区当前未提交的改动（git status 以及暂存区和工作区的 diff）',
      label: 'git status --short && git diff --staged && git diff',
      command: cut(`${GIT} status --short && ${GIT} diff --staged --no-ext-diff --no-textconv && ${GIT} diff --no-ext-diff --no-textconv`) })
    candidates.push({ id: 'files', description: '项目中受版本管理的文件列表', label: 'git ls-files', command: cut(`${GIT} ls-files`) })
  }
  if (facts.readme !== undefined) {
    candidates.push({ id: 'readme', description: `项目说明文件 ${facts.readme}`, label: `cat ${facts.readme}`, command: cut(`cat -- ${shellWord(facts.readme)}`) })
  }
  if (facts.manifest !== undefined) {
    candidates.push({ id: 'manifest', description: `项目清单 ${facts.manifest}（名称、版本、脚本、依赖）`, label: `cat ${facts.manifest}`,
      command: cut(`cat -- ${shellWord(facts.manifest)}`) })
  }
  for (const path of facts.mentioned.slice(0, 6)) {
    candidates.push({ id: `file:${path}`, description: `用户输入中提到的文件 ${path} 的内容`, label: `cat ${path}`, command: cut(`cat -- ${shellWord(path)}`) })
  }
  const terms = searchTerms(input, config.maxSearchTerms)
  if (facts.git && terms.length > 0) {
    // Substring matching, so a word of the input also finds identifiers that contain it (items → MAX_ITEMS_PER_ORDER).
    candidates.push({ id: 'search', description: `在项目文件中搜索包含 ${terms.join('、')} 的行（不区分大小写，标识符中的部分匹配也算）`,
      label: `git grep -n -i ${terms.join(' ')}`, command: cut(`${GIT} grep -n -I -i -F ${terms.map(term => `-e ${shellWord(term)}`).join(' ')}`) })
  }
  if (facts.git && facts.trackedFiles > 0 && facts.trackedFiles <= config.maxSourceFiles) {
    candidates.push({ id: 'sources', description: '项目全部文件的内容（项目很小，可以一次读完）', label: 'cat $(git ls-files)',
      command: cut(`${GIT} ls-files -z | xargs -0 grep -I -l '' -- 2>/dev/null | while IFS= read -r f; do printf '==> %s <==\\n' "$f"; cat -- "$f"; echo; done`) })
  }
  return candidates.slice(0, 16)
}

const questionKey = (index: number): string => `p${String(index)}`

/** One yes/no question per candidate fact; the input is quoted because Jev relates referenced state poorly. */
export const system3PrefetchDecision: System3DecisionSpec<PrefetchInput, 'prefetch' | 'none'> = {
  id: 'prefetch',
  version: 1,
  state: input => ({ input: input.input, facts: input.candidates.map(candidate => candidate.description) }),
  questions: input => Object.fromEntries(input.candidates.map((candidate, index) => [questionKey(index), {
    type: 'noul' as const,
    instructions: `用户输入：「${input.input}」。助手回答或执行这条输入时，是否需要先看到工作区里的这项信息：${candidate.description}？`
      + '只有当这项信息能直接帮助回答或完成这条输入时才算需要；闲聊、常识问题或与这个项目无关的输入都不需要。',
    criteria: { true: '需要先看到', false: '不需要' },
  }])),
  decide(response, settings, input) {
    const verdicts = input.candidates.map((_candidate, index) => {
      const answer = response.answers[questionKey(index)]
      return answer?.type === 'noul' ? noulVerdict(answer.noul, settings) : 'unsure'
    })
    if (verdicts.includes('yes')) return 'prefetch'
    return verdicts.every(verdict => verdict === 'no') ? 'none' : 'unsure'
  },
  fallback: 'none',
}

/**
 * Render prefetched outputs as the main model sees them.
 * @param outputs - Candidates with their command output, in order.
 * @param config - Size limits of prefetch.
 * @returns Model-visible text and the ids it carries, or undefined when nothing fits.
 */
export function prefetchText(outputs: ReadonlyArray<{ readonly candidate: System3PrefetchCandidate; readonly output: string }>,
  config: Pick<System3PrefetchConfig, 'maxItemBytes' | 'maxTotalBytes'>): { readonly text: string; readonly items: string[] } | undefined {
  const parts: string[] = []
  const items: string[] = []
  const omitted: string[] = []
  let total = 0
  for (const { candidate, output } of outputs) {
    const bytes = Buffer.from(output, 'utf8')
    const body = bytes.byteLength > config.maxItemBytes
      ? `${bytes.subarray(0, config.maxItemBytes).toString('utf8').replace(/�$/u, '')}\n[输出超过 ${String(config.maxItemBytes)} 字节，已截断]`
      : output.trimEnd()
    const part = `$ ${candidate.label}\n${body === '' ? '[无输出]' : body}`
    if (total + Buffer.byteLength(part, 'utf8') > config.maxTotalBytes) { omitted.push(candidate.label); continue }
    total += Buffer.byteLength(part, 'utf8')
    parts.push(part)
    items.push(candidate.id)
  }
  if (parts.length === 0) return undefined
  return {
    text: ['[System3 预取] 以下是为这条输入预先读取的工作区信息（只读命令，在沙箱中执行，结果为本次请求时的状态）。'
      + '可以直接据此回答；信息不够时再调用工具。', ...parts,
    ...omitted.length === 0 ? [] : [`[超过总大小上限未附上：${omitted.join('；')}]`]].join('\n\n'),
    items,
  }
}

/** Services and policy prefetch needs. */
export interface System3PrefetchSettings {
  readonly config: System3PrefetchConfig
  readonly policy: System3PrivacyPolicy
  readonly options: System3JevOptions
}

/**
 * Reject a prefetch configuration that cannot work.
 * @param config - Prefetch settings from deployment configuration.
 */
export function validateSystem3Prefetch(config: System3PrefetchConfig): void {
  validateSystem3DecisionSettings('prefetch', config)
  for (const key of ['maxItemBytes', 'maxTotalBytes', 'maxSourceFiles', 'maxSearchTerms', 'commandTimeoutMs'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`prefetch ${key} must be a positive integer`)
  }
}

/** Text of the person's input in a step, when every message of it is plain text. */
function personInput(messages: readonly UserMessage[]): string | undefined {
  const users = messages.filter(message => message.source.kind === 'user')
  if (users.length === 0 || users.some(message => message.content.some(block => block.type !== 'text'))) return undefined
  const text = users.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n').trim()
  return text === '' || /^\/[a-z0-9-]+(?:\s|$)/u.test(text) ? undefined : text
}

/**
 * Prefetch read-only workspace facts for each person input of a top-level Agent. At the `agent/pre-step` that carries
 * the input, one discovery command lists the candidates; every candidate command then starts in the read-only sandbox
 * while one Jev request (decision `prefetch`) asks a yes/no question per candidate and later pre-step listeners run.
 * In `active` mode the outputs of the candidates judged needed, within `maxItemBytes` each and `maxTotalBytes` together,
 * enter the step as one `system3-prefetch` message after the input; `shadow` records only `system3/judgement`. Privacy
 * refusal, a Jev failure, the deadline, a missing shell service, and commands that fail all leave the step unchanged.
 * @param ctx - Plugin context; listeners are disposed with it.
 * @param settings - Prefetch settings, privacy policy, and Jev options.
 */
export function installSystem3Prefetch(ctx: Context, settings: System3PrefetchSettings): void {
  const { config } = settings
  validateSystem3Prefetch(config)
  const shared: System3DecisionContext = { policy: settings.policy, options: settings.options, dataClasses: config.sessionDataClasses }
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'system3.prefetch()')

  const run = async (shell: Pick<ShellExecutor, 'resolve' | 'execute'>, agent: Agent, cwd: string, command: string,
    signal: AbortSignal): Promise<string | undefined> => {
    try {
      const result = await (await shell.execute(shell.resolve({ command, workdir: cwd, timeoutMs: config.commandTimeoutMs, signal,
        stdoutMaxBytes: config.maxItemBytes + 1, sandboxPolicy: { mode: 'read-only', workspaceRoot: cwd, sessionId: agent.session.id } }))).result()
      return result.exitCode === 0 ? result.stdout.text : undefined
    } catch (error) {
      if (signal.aborted) throw error
      // A command the sandbox cannot start only leaves this fact out; the step proceeds without it.
      return undefined
    }
  }

  const prepare = async (agent: Agent, input: string, signal: AbortSignal): Promise<UserMessage | undefined> => {
    const shell = ctx.get('shell')
    const cwd = agent.session.header.cwd
    if (shell === undefined || cwd === undefined) return undefined
    const discovered = await run(shell, agent, cwd, discoveryCommand(mentionedPaths(input)), signal)
    if (discovered === undefined) return undefined
    const candidates = prefetchCandidates(input, parseWorkspaceFacts(discovered), config)
    if (candidates.length === 0) return undefined
    const outputs = candidates.map(candidate => run(shell, agent, cwd, candidate.command, signal))
    const result = await runSystem3Decision(ctx, shared, system3PrefetchDecision, config, agent, { input, candidates }, signal)
    if (result.outcome !== 'prefetch') return undefined
    const answers = result.judgement.response?.answers ?? {}
    const needed = (await Promise.all(candidates.map(async (candidate, index) => {
      const answer = answers[questionKey(index)]
      if (answer?.type !== 'noul' || noulVerdict(answer.noul, config) !== 'yes') return []
      const output = await outputs[index]
      return output === undefined ? [] : [{ candidate, output }]
    }))).flat()
    const rendered = prefetchText(needed, config)
    if (rendered === undefined) return undefined
    return createUserMessage({ content: [{ type: 'text', text: rendered.text }], source: { kind: 'system3-prefetch', items: rendered.items } })
  }

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    if (config.mode === 'off' || settings.options.frontLoaded?.() === false
      || (agent.session.header.delegationDepth ?? 0) !== 0) return next()
    const input = personInput(messages)
    if (input === undefined) return next()
    const work = AbortSignal.any([signal, lifetime.signal])
    // Started before next(), so discovery, the commands, and the Jev request overlap later pre-step listeners.
    const pending = prepare(agent, input, work)
    pending.catch(() => undefined)
    const decision = await next()
    let message: UserMessage | undefined
    try {
      message = await pending
    } catch (error) {
      if (signal.aborted) throw error
      if (!lifetime.signal.aborted) ctx.logger.warn(`system3 prefetch: ${String(error)}`)
    }
    if (decision.kind === 'reject' || message === undefined) return decision
    return { ...decision, messages: [...decision.messages, message] }
  })
}
