/** V4-to-V5 admission widening with released V4 physical framing. */

import { defineSessionFormatMigration, SessionFormatError, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatEvent,
  SessionFormatEventRun,
  SessionFormatMigration,
  SessionFormatMigrationContext,
  SessionFormatMigrationStage,
  SessionFormatMigrationStageInput,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** Header-only declaration; the body stage preserves every event unchanged. */
export const sessionFormatV4ToV5: SessionFormatMigration = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  createStage(input) {
    return new ReleasedV4ToV5Stage(input)
  },
  validateTargetHeader: assertReleasedV5Header,
})

/**
 * One artifact's V4-to-V5 state. V5 changes no event representation and adds no
 * event, so the stage forwards each source event unchanged; only the inherited
 * cut needs re-establishing, because a seeded V4 artifact can leave it unknown
 * until the last inherited end-seed marker.
 */
class ReleasedV4ToV5Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private cut: number | undefined
  private nextSeq = 0

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    this.cut = input.sourceHeader.isSeeded ? input.sourceInheritedEventCount : 0
    if (!input.sourceHeader.isSeeded) this.headerInheritedEventCount = 0
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    const targetSeq = this.nextSeq++
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) {
      if (!this.input.sourceHeader.isSeeded) throw new SessionFormatError('unseeded format v4 Session contains an inherited end-seed marker')
      this.cut = targetSeq
    }
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(): number {
    const cut = sessionFormatCount(this.cut, 'V4 inherited event count')
    if (this.input.sourceInheritedEventCount !== undefined && this.input.sourceInheritedEventCount !== cut) {
      throw new SessionFormatError('format v4 inherited cut disagrees with its source marker')
    }
    return cut
  }
}
