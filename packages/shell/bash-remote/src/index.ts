/** Native Bash lifecycle over an isolated remote subprocess provider. @module @deepseek-ai/dsh-bash-remote */

import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell'

export type { Config } from '@deepseek-ai/dsh-bash-local'

/** Keeps native deadlines, background jobs, incremental output and cancellation. */
export class RemoteBashExecutor extends LocalBashExecutor {
  override resolve(request: ShellExecRequest): ShellExecSpec {
    if (!request.agentId) throw new Error('bash-remote request names no agent')
    return super.resolve(request)
  }
}

export default RemoteBashExecutor
