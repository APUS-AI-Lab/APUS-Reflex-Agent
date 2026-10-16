/** Session-backed product memory with editable defaults and explicit opt-in. */
import ContinuumMemory, { ContinuumConfigFields } from '@deepseek-ai/dsh-continuum'
import z from '@deepseek-ai/schemastery'

/** Product profile provider; Core owns admission, persistence, projection and lifecycle. */
export default class ProductContinuumMemory extends ContinuumMemory {
  static override Config = z.object({
    ...ContinuumConfigFields,
    mode: z.union([z.const('off'), z.const('shadow'), z.const('active')]).default('active').volatile(),
    admission: z.union([z.const('explicit'), z.const('user-message'), z.const('compaction')]).default('compaction'),
    candidatePool: z.union([z.const('lexical'), z.const('all')]).default('all'),
    maxPool: z.number().step(1).min(1).default(200),
    scopes: z.array(z.string()).default(['workspace']),
  })
}
