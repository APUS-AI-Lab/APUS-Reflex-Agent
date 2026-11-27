import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ToolRuntime, {
  defineTool,
  TOOL_RUNTIME_SCHEDULER,
} from '@deepseek-ai/dsh-tools'

const signal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** A session-owning Agent stub with one open turn; no loop runs. */
function fakeAgent(id = 'trajectory-agent'): Agent {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

function eventsOf(agent: Agent): ReturnType<Agent['session']['snapshotEvents']> {
  return agent.session.snapshotEvents()
}

const echo = defineTool({
  name: 'echo',
  description: 'echo arguments back',
  parameters: { text: { type: 'string' } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute(args) {
    return args.text ?? ''
  },
})

describe('tool trajectory observations', () => {



  it('records the stage and thrower of a pipeline failure', async () => {
    const ctx = await setup()
    ctx.tools.register(echo)
    ctx.on('tools/pre-execute', async () => { throw new Error('listener exploded') })
    const agent = fakeAgent()

    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('c1'), name: 'echo', arguments: {}, agent,
    })
    expect(result.isError).toBe(true)

    const failure = eventsOf(agent).find(event => event.type === 'tool/pipeline-error')
    if (failure?.type !== 'tool/pipeline-error') throw new Error('expected a pipeline error event')
    expect(failure.data).toEqual({
      callId: 'c1',
      rootCallId: 'c1',
      name: 'echo',
      stage: 'pre-execute',
      thrower: 'listener',
      error: { name: 'Error', message: 'listener exploded' },
      normalizedToIsError: true,
    })
  })

  it('records a definition-owned projection failure at its exact stage', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'projecting',
      description: 'projecting tool',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { return 'value' },
      projectContent() { throw new Error('projection exploded') },
    }))
    const agent = fakeAgent()

    await ctx.tools.execute({
      signal, callId: ToolCallId('c2'), name: 'projecting', arguments: {}, agent,
    })

    const failure = eventsOf(agent).find(event => event.type === 'tool/pipeline-error')
    if (failure?.type !== 'tool/pipeline-error') throw new Error('expected a pipeline error event')
    expect(failure.data).toMatchObject({
      stage: 'projectContent', thrower: 'definition', error: { message: 'projection exploded' },
    })
  })


  it('resolves scoped restriction omissions for the catalog record', async () => {
    const ctx = await setup()
    ctx.tools.register(echo)
    const key = { id: 'catalog-agent' } as Agent
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
      { inject: ['tools', 'systemPrompt'] }))
    scope.ctx.tools.restrict({ deny: ['echo'] })

    expect(ctx.tools[TOOL_RUNTIME_SCHEDULER].catalog(undefined)).toEqual({ mode: 'native', omissions: [] })
    expect(ctx.tools[TOOL_RUNTIME_SCHEDULER].catalog(key)).toEqual({
      mode: 'native',
      omissions: [{ name: 'echo', reason: 'restricted' }],
    })
  })
})
