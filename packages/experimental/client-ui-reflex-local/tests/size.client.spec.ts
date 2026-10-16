/** Memory shortfall needs a supported device to compare against. */
import { expect, it } from 'vitest'
import { memoryShortfall } from '../src/client/size.ts'
import { OPTIONS, snapshotOf } from './snapshot-fixture.client.ts'

it('reports no memory shortfall without device memory to compare against', () => {
  const snapshot = snapshotOf({ phase: 'unsupported' }, { device: { supported: false, reason: 'platform' } })
  expect(memoryShortfall(snapshot, OPTIONS[3]!)).toBeUndefined()
})
