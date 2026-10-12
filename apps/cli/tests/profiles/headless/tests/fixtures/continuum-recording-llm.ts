import { appendFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

/** Keyless adapter that records every model-visible request for profile acceptance. */
class ContinuumRecordingAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF } }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const path = process.env.CONTINUUM_REQUEST_LOG
    if (path !== undefined) await appendFile(path, `${JSON.stringify(options.messages)}\n`)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'recorded' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recorded' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'continuum-recording-llm'
export const inject = ['llm']

/** Register the keyless Continuum request recorder. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.llm.registerAdapter(['continuum-recording'], new ContinuumRecordingAdapter()))
}
