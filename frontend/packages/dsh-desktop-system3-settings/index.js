/** Opt-in desktop composition of the existing Jev and System3 services. */
import z from '@deepseek-ai/schemastery'

/** Stable Desktop plugin identity. */
export const name = 'dsh-desktop-system3-settings'
/** Read-only route served behind the native API authentication policy. */
export const STATUS_PATH = '/api/desktop-system3.status'

/** Validate activation before Config is persisted or any child service mounts.
 * @param config Schema-resolved settings.
 * @returns The validated settings.
 */
export function validateSettings(config) {
  if (!config.enabled) return config
  let endpoint
  try { endpoint = new URL(config.endpoint) } catch (_error) { throw new Error('Enter an absolute HTTP(S) Jev endpoint') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Jev endpoint must be HTTP(S) without credentials, query or fragment')
  }
  if (!config.model.trim()) throw new Error('Enter a Jev model ID')
  if (!config.remoteApproved || config.dataClasses.length === 0) throw new Error('Select and approve the data sent to Jev and model providers')
  if (config.candidates.length === 0 || config.candidates.length > 254) throw new Error('Add 1–254 routing candidates from Models settings')
  const ids = new Set()
  for (const candidate of config.candidates) {
    if (!/^[a-z][a-z0-9-]*$/.test(candidate.id) || ['jev', 'baseline', 'abstain', 'unknown'].includes(candidate.id) || ids.has(candidate.id)) {
      throw new Error('Candidate IDs must be unique lowercase names; jev, baseline, abstain and unknown are reserved')
    }
    ids.add(candidate.id)
    if (![candidate.provider, candidate.model, candidate.description].every(value => value.trim().length > 0)) {
      throw new Error('Each candidate needs a Provider ID, Model ID and routing description')
    }
  }
  return config
}

/** Desktop settings schema; literal credentials never enter this configuration. */
export const Settings = z.transform(z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().default(''),
  protocol: z.union(['openjev', 'typesafe']).default('openjev'),
  model: z.string().default(''),
  credentialRef: z.string().pattern(/^(?:[A-Za-z_][A-Za-z0-9_]*|)$/).role('credential-ref').default('APUS_JEV_API_KEY'),
  remoteApproved: z.boolean().default(false),
  dataClasses: z.array(z.union(['public', 'workspace', 'sensitive', 'secret'])).default([]),
  candidates: z.array(z.object({
    id: z.string().required(),
    provider: z.string().required(),
    model: z.string().required(),
    description: z.string().required(),
  })).default([]),
  timeoutMs: z.number().step(1).min(1).max(2147483647).default(15000),
  minConfidence: z.number().min(0).max(1).default(0.8),
  maxInputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16384),
}), validateSettings, true)

/** The settings object is replaced atomically through the native live Config store. */
export const Config = z.object({ settings: Settings.default({}).volatile() })

/** Build the existing service configs without choosing deployment endpoints or providers.
 * @param config Validated desktop settings.
 * @returns Jev and System3 configurations containing no literal credentials.
 */
export function serviceConfigs(config) {
  validateSettings(config)
  return {
    jev: {
      endpoint: config.endpoint, protocol: config.protocol, model: config.model,
      timeoutMs: config.timeoutMs,
      ...(config.credentialRef ? { apiKeyEnv: config.credentialRef } : {}),
    },
    system3: {
      privacyMode: 'controlled',
      approvedRemoteIds: ['jev', 'baseline', ...config.candidates.map(candidate => candidate.id)],
      approvedRemoteDataClasses: config.dataClasses,
      jevRouteId: 'jev', jevExecutionDomain: 'network',
      entryRouting: {
        deadlineMs: config.timeoutMs,
        baseline: { executionDomain: 'network', dataClasses: config.dataClasses },
        candidates: config.candidates.map(candidate => ({ ...candidate, executionDomain: 'network', dataClasses: config.dataClasses })),
        sessionDataClasses: config.dataClasses,
        minConfidence: config.minConfidence,
        maxInputBytes: config.maxInputBytes,
      },
    },
  }
}

/** Serialize live changes and wait for active children before completing teardown.
 * @param ctx Owning Cordis plugin context.
 * @param read Read the current settings reference.
 * @param loadServices Resolve the Jev and System3 implementations from the prepared runtime.
 * @returns A reader of the settled local activation state, without endpoint or error details.
 */
export async function mountSettings(ctx, read, loadServices) {
  let active
  let closed = false
  let last
  let state = 'disabled'
  let error = null
  let tail = Promise.resolve()
  const disposeActive = async () => {
    const previous = active
    active = undefined
    if (previous) await previous.dispose()
  }
  const reconcile = async () => {
    if (closed) return
    const config = structuredClone(read())
    const signature = JSON.stringify(config)
    if (signature === last && state !== 'error') return
    if (!config.enabled) {
      await disposeActive()
      last = signature
      state = 'disabled'
      error = null
      return
    }
    state = 'starting'
    error = null
    const options = serviceConfigs(config)
    const { Jev, System3 } = await loadServices()
    if (closed) return
    // Resolve before removing the working services so malformed configs cannot interrupt them.
    Jev.Config(options.jev)
    System3.Config(options.system3)
    await disposeActive()
    if (closed) return
    if (ctx.get('jev') || ctx.get('system3')) {
      error = 'service-conflict'
      throw new Error('Disable the existing Jev/System3 profile before enabling desktop collaboration')
    }
    active = await ctx.plugin({
      name: 'desktop-system3-active',
      async apply(scope) {
        await scope.plugin(Jev, options.jev)
        await scope.plugin(System3, options.system3)
      },
    })
    last = signature
    state = 'ready'
  }
  const enqueue = () => {
    const operation = tail.then(reconcile)
    tail = operation.catch(cause => {
      state = 'error'
      error ??= 'activation-failed'
      ctx.logger.error('System3 service activation failed; correct or disable it in Settings → System3')
      // Only local package/lifecycle failures reach this path; status never serializes their details.
      ctx.logger.debug(cause)
    })
    return operation
  }
  ctx.on('loader/volatile-update', () => { void enqueue() })
  ctx.effect(() => async () => {
    closed = true
    await tail
    await disposeActive()
  })
  // Keep the settings owner alive on activation failure so users can repair or disable it.
  void enqueue()
  await tail
  return { async status() { await tail; return { state, error } } }
}

/** Mount only explicitly enabled services; credentials remain owned by the native store.
 * @param ctx Owning Cordis plugin context.
 * @param config Validated Config with its live settings reference.
 */
export async function apply(ctx, config) {
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
  const controller = await mountSettings(ctx, () => config.settings.get(), async () => {
    // The prepared runtime owns these optional packages; disabled installs do not resolve them.
    const packages = ['@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin', '@deepseek-ai/dsh-experimental-system3']
    const [{ default: Jev }, { default: System3 }] = await Promise.all(packages.map(name => import(/* @vite-ignore */ name)))
    return { Jev, System3 }
  })
  ctx.inject(['connection'], scope => {
    scope.effect(() => scope.connection.fetch.register({
      path: STATUS_PATH, methods: ['GET'], requestBody: 'buffered',
      fetch: async () => Response.json(await controller.status(), { headers: { 'cache-control': 'no-store' } }),
    }))
  })
}
