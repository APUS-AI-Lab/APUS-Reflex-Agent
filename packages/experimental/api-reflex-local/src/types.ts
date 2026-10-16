/** JSON-safe readiness values exchanged by the local decision engine Remote namespace. */
import type { ReflexLifecycleErrorDetails } from '@deepseek-ai/dsh-experimental-reflex-local/types'

export type {
  ReflexDeviceSupport, ReflexDownloadFailure, ReflexFailure, ReflexInventory, ReflexLifecycleErrorCode, ReflexLifecycleErrorDetails,
  ReflexModelId, ReflexModelOption, ReflexPreparation, ReflexPrepareOptions, ReflexQuant, ReflexRunnerStatus, ReflexSelectOptions,
  ReflexSelfTest, ReflexSnapshot, ReflexSwitch, ReflexVariant,
} from '@deepseek-ai/dsh-experimental-reflex-local/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Another model is being prepared; pause or cancel it before selecting the requested one. */
    'reflexLocal/preparing-other': ReflexLifecycleErrorDetails['preparing-other']
    /** The model needs more memory than this device has; repeat the request with `allowUnfit` after the user agrees. */
    'reflexLocal/unfit': ReflexLifecycleErrorDetails['unfit']
  }
}
