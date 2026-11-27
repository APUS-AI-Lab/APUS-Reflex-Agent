import { describe, expect, it } from 'vitest'
import { SDK_REQUEST_VIEW_CAPABILITY } from '../src/index.ts'
import type {
  HarnessSdkRequestMap,
  SdkRequestView,
  SessionDispatchesParams,
  SessionRequestViewParams,
  SessionStatusNotification,
} from '../src/index.ts'

/**
 * The request-view capability is a wire-stable token, not a free-form string
 * repeated in each layer: clients and runtimes must agree on the exact value.
 */
describe('SDK protocol request-view surface', () => {
  it('publishes a wire-stable request-view capability token', () => {
    expect(SDK_REQUEST_VIEW_CAPABILITY).toBe('request-view/dispatch-v1')
  })

  it('carries the optional settlement outcome on an idle status notification', () => {
    // A caller can tell a proven quiescence from a stopped loop whose evidence
    // barrier failed; a runtime that applies no barrier omits the member.
    const settled: SessionStatusNotification = { sessionId: 'main', status: 'idle', settlement: 'settled' }
    const failed: SessionStatusNotification = { sessionId: 'main', status: 'idle', settlement: 'failed' }
    const plain: SessionStatusNotification = { sessionId: 'main', status: 'idle' }
    expect([settled.settlement, failed.settlement, plain.settlement]).toEqual(['settled', 'failed', undefined])
    expect('settlement' in { sessionId: 'main', status: 'running' }).toBe(false)
  })

  it('names both read-only request methods in the request map', () => {
    const methods = ['session/dispatches', 'session/request-view'] as const satisfies readonly (keyof HarnessSdkRequestMap)[]
    expect(methods).toEqual(['session/dispatches', 'session/request-view'])
    const params: SessionDispatchesParams = { sessionId: 'main' }
    const viewParams: SessionRequestViewParams = { sessionId: 'main', dispatchSeq: 3 }
    expect(params.sessionId).toBe('main')
    expect(viewParams.dispatchSeq).toBe(3)
    // A view carries the dispatch identity and the reconstructed request, never
    // an approximate provider wire body.
    const view: SdkRequestView = {
      sessionId: 'main',
      dispatchSeq: 3,
      prefixEnd: 9,
      turn: 1,
      step: 1,
      header: { config: { provider: 'p', model: 'm' } },
      messages: [],
      toolHistory: { tools: [], updates: [] },
      projectionTypes: [],
    }
    expect(view.header.config.model).toBe('m')
  })
})
