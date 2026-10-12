/** Literal verification targets from a restricted POSIX command AST; never executes shell code. */
import { parseShell } from '@yarnpkg/parsers'

/** Strictly recognized native command transport. */
export type VerificationEnvelope = 'direct' | 'posix-shell' | 'unsupported'

/** Fixed parser diagnostics; never contains command text or rejected argument values. */
export type VerificationRejection = 'platform' | 'missing-command' | 'over-budget' | 'control-character'
  | 'syntax' | 'compound' | 'environment' | 'redirection' | 'nonliteral' | 'wrapper' | 'command' | 'options' | 'target'

function literalCommand(command: string): string[] | VerificationRejection {
  let lines: ReturnType<typeof parseShell>
  try { lines = parseShell(command) } catch (error) { // Invalid shell syntax supplies no verification evidence.
    void error
    return 'syntax'
  }
  const line = lines[0]
  if (lines.length !== 1 || line?.type !== ';' || line.command.then) return 'compound'
  const chain = line.command.chain
  if (chain.type !== 'command' || chain.then) return 'compound'
  if (chain.envs.length !== 0) return 'environment'
  const args: string[] = []
  for (const arg of chain.args) {
    if (arg.type !== 'argument') return 'redirection'
    let text = ''
    for (const segment of arg.segments) {
      if (segment.type !== 'text') return 'nonliteral'
      text += segment.text
    }
    args.push(text)
  }
  return args
}

/**
 * Recognize literal pytest or unittest file arguments, optionally inside one POSIX shell wrapper.
 * @param command - Native completed command text, retained locally only.
 * @param maxCommandChars - Pre-parse character budget.
 * @param platform - Native host platform; Windows command grammars are unsupported.
 * @returns Transport classification and literal file targets; unsupported syntax returns no targets.
 */
export function verificationTargets(command: unknown, maxCommandChars: number,
  platform: NodeJS.Platform = process.platform): { envelope: VerificationEnvelope; paths: string[]; rejection?: VerificationRejection } {
  const unsupported = (rejection: VerificationRejection) => ({ envelope: 'unsupported' as const, paths: [], rejection })
  if (platform === 'win32') return unsupported('platform')
  if (typeof command !== 'string') return unsupported('missing-command')
  if (command.length > maxCommandChars) return unsupported('over-budget')
  if (/[\x00-\x1f\x7f]/u.test(command)) return unsupported('control-character')
  let args = literalCommand(command)
  if (typeof args === 'string') return unsupported(args)
  let envelope: VerificationEnvelope = 'direct'
  if (/^(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh)$/u.test(String(args[0]))) {
    const payload = args[2]
    if (args.length !== 3 || (args[1] !== '-c' && args[1] !== '-lc') || payload === undefined) return unsupported('wrapper')
    args = literalCommand(payload)
    if (typeof args === 'string') return unsupported(args)
    envelope = 'posix-shell'
  }
  let targets: string[]
  if (args[0] === 'pytest') targets = args.slice(1)
  else if ((args[0] === 'python' || args[0] === 'python3') && args[1] === '-m'
    && (args[2] === 'pytest' || args[2] === 'unittest')) targets = args.slice(3)
  else return unsupported('command')
  if (targets.some(target => target.startsWith('-'))) return unsupported('options')
  if (targets.length === 0 || targets.some(target => !/^(?!-)[A-Za-z0-9_./-]+\.py$/u.test(target))) return unsupported('target')
  return { envelope, paths: [...new Set(targets)] }
}
