/** Session-backed product memory with editable defaults and explicit opt-in. */
import ContinuumMemory, { ContinuumConfigFields } from '@deepseek-ai/dsh-continuum'
import z from '@deepseek-ai/schemastery'

/** Product profile provider; Core owns admission, persistence, projection and lifecycle. */
export default class ProductContinuumMemory extends ContinuumMemory {
  static override Config = z.object({
    ...ContinuumConfigFields,
    mode: z.union([z.const('off'), z.const('shadow'), z.const('active')]).default('active').volatile(),
    admission: z.union([z.const('explicit'), z.const('user-message')]).default('user-message'),
    scopes: z.array(z.string()).default(['workspace']),
  })
}
