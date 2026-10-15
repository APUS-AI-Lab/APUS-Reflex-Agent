# 扩展

[English](extensions.md) | 中文

extensions 子系统允许 agent（智能体）定义带版本的 Cordis 包、运行其 host 与浏览器两半，并在编写代码前查询获准公开的运行时元数据。包生命周期与沙箱行为由 [`packages/extensions`](../../packages/extensions/README.zh.md) 包组说明。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcontinuummemory--continuummemoryservice"></a>

### `ctx.continuumMemory` — `ContinuumMemoryService`

Public service seam used by profile consumers and tests.

```ts cordis-catalog
/**
 * Return the current switch decision for this profile.
 * @returns The effective feature switch decision.
 */
state(): ReturnType<ContinuumMemoryController['state']>

/**
 * Get the controller associated with one Agent, restoring it from Session events once.
 * @param agent - Agent whose Session owns the memory projection.
 * @returns The controller for the Agent's memory projection.
 */
controller(agent: Agent): ContinuumMemoryController

/**
 * Admit and persist one source-backed record in the Agent's Session.
 * @param agent - Agent whose Session receives the record event.
 * @param record - Source-backed record to admit.
 * @returns The created immutable record.
 */
create(agent: Agent, record: NewMemoryRecord): MemoryRecord

/**
 * Supersede and persist one record correction.
 * @param agent - Agent whose Session receives the correction event.
 * @param id - Existing record identifier.
 * @param expectedRevision - Revision observed by the caller.
 * @param replacement - Source-backed successor record.
 * @returns The created successor record.
 */
supersede(agent: Agent, id: MemoryId, expectedRevision: number, replacement: NewMemoryRecord): MemoryRecord

/**
 * Deactivate and persist one record.
 * @param agent - Agent whose Session receives the deactivation event.
 * @param id - Existing record identifier.
 * @param expectedRevision - Revision observed by the caller.
 * @returns The deactivated immutable record.
 */
deactivate(agent: Agent, id: MemoryId, expectedRevision: number): MemoryRecord
```

Types: [Agent](core.zh.md)

Source: [`packages/context/continuum/src/service.ts`](../../packages/context/continuum/src/service.ts)

<a id="ctxcontinuumtaskguard--continuumtaskguard"></a>

### `ctx.continuumTaskGuard` — `ContinuumTaskGuard`

Owns task-binding recovery in every shipped profile. Unbound Sessions need no task service. Bound Sessions must retain a ready, matching authority; removing the optional task plugin cannot silently reactivate stale history or summaries.

Source: [`packages/context/continuum/src/task-guard.ts`](../../packages/context/continuum/src/task-guard.ts)

<a id="ctxcontinuumtasks--continuumtasks"></a>

### `ctx.continuumTasks` — `ContinuumTasks`

Durable tasks with complete text admission and bounded model context. One host identity and exact workspace are authorized by configuration. Sources stay in business Sessions; the leased authority log uses a separate storage root. Retiring an entry refuses already-bound Sessions because their prior model outputs or summaries may still contain it; a fresh Session can use the new state.

```ts cordis-catalog
/**
 * Read the current authorized task without marking its entries processed.
 * @param agent - Live caller in the configured workspace.
 * @returns Immutable complete task or undefined before its first input.
 */
async snapshot(agent: Agent): Promise<TaskSnapshot | undefined>

/**
 * Verify a recovered binding synchronously for the always-mounted dispatch guard.
 * This does not replace source authorization or the request's revision lease.
 * @param session - Exact live Session about to send model context.
 * @param binding - Its immutable recovered task authority and retirement set.
 */
assertAuthority(session: Session, binding: TaskBinding): void

/**
 * Read a bounded page of current task inputs. Retired sources remain in the journal.
 * @param agent - Live caller in the configured workspace.
 * @param options - Revision-bound page position; deployment owns the byte budget.
 * @returns JSON with exact text, source references and a continuation cursor.
 */
async read(agent: Agent, options: Omit<TaskPageOptions, 'maxBytes'> = {}): Promise<string>

/**
 * Apply an explicit host-authorized correction using exact durable human text.
 * Already-bound Sessions refuse subsequent dispatch until opened anew.
 * @param agent - Caller authorized by the mounted host configuration.
 * @param request - Stable request identity, observed domain revision and source-backed replacement.
 * @returns A receipt after durable commit and exact readback.
 */
async supersede(agent: Agent, request: { readonly requestId: string readonly expectedRevision: number readonly predecessor: MemoryId readonly source: TaskSourceInput }): Promise<TaskReceipt>
```

Types: [Agent](core.zh.md) · [Session](session.zh.md)

Source: [`packages/context/continuum/src/task-service.ts`](../../packages/context/continuum/src/task-service.ts)

<a id="ctxcordisinspect--cordisinspectregistryservice"></a>

### `ctx.cordisInspect` — `CordisInspectRegistryService`

Registry and cross-page router behind the two model-facing inspect tools.

```ts cordis-catalog
/**
 * Register one Host provider.
 * @param registration - manifest and local query handler.
 * @returns idempotent disposer.
 */
register(registration: HostCordisInspectProviderRegistration): () => void

/**
 * Replace the mirrored Client provider directory.
 * @param providers - complete Client manifest snapshot.
 */
syncClientManifest(providers: readonly CordisInspectProviderManifest[]): void

/**
 * Return the complete known Host and Client provider directory.
 * @returns Host providers followed by the Client providers.
 */
list(): CordisInspectProviderView[]

/**
 * Execute one provider query on its owning platform.
 * @param platform - Host or Client runtime.
 * @param providerId - provider selected from {@link list}.
 * @param methodName - declared method name.
 * @param input - optional lossless JSON input.
 * @param agent - requesting Agent and scope.
 * @param signal - tool-call cancellation.
 * @returns provider JSON data.
 */
async query( platform: CordisInspectPlatform, providerId: string, methodName: string, input: JsonValue | undefined, agent: Agent, signal: AbortSignal, ): Promise<JsonValue>

/**
 * Accept the first valid Client response for a pending query.
 * @param agent - Agent whose Session owns the query.
 * @param requestId - Pending Client query identity.
 * @param resolution - Client provider result or failure.
 * @returns whether this response settled the still-pending query.
 */
resolveClientQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck
```

Types: [Agent](core.zh.md)

Source: [`packages/extensions/cordis-host-runner/src/inspect-registry.ts`](../../packages/extensions/cordis-host-runner/src/inspect-registry.ts)

<a id="ctxdynamiccordisrunner--dynamiccordisrunnerservice"></a>

### `ctx.dynamicCordisRunner` — `DynamicCordisRunnerService`

Dynamic Plugin registry and Host-half lifecycle.

```ts cordis-catalog
/**
 * Define a new Plugin's first Package or append a Package to an existing Plugin.
 * @param request - Session ownership, Plugin selection, metadata, and source code.
 * @returns Host-minted Plugin and Package identities with declared-half metadata.
 */
define(request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt

/**
 * Remove a Plugin, its active run, and all immutable Packages.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
@Remote('undefineFromPanel') async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Start or update one Package for a model tool call. An unauthorized Client
 * Package waits for approval; Plugin-wide authorization covers later versions.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param signal - Tool-call cancellation signal while the activation request is being created.
 * @returns The successful activation identity or an actionable refusal.
 */
async run( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, signal?: AbortSignal, ): Promise<DynamicCordisRunResponse>

/**
 * Start Host code for an approved request or a direct panel gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param requestId - Model-driven request identity, or null for a direct user gesture.
 * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
 * @returns The exact Host activation or a failure message.
 */
@Remote('runHostHalf') async runHostHalf( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, requestId: ApprovalRequestId | null, approveFutureVersions: boolean, ): Promise<DynamicCordisHostHalfResult>

/**
 * Fetch Client code for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to read.
 * @param pluginRunId - Exact active run authorized to receive source.
 * @returns Client source and its Plugin, Package, and run identities.
 */
@Remote('getClientCode') getClientCode( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, ): DynamicCordisClientSource

/**
 * Resolve one model-driven Client activation request.
 * @param requestId - Request identity to settle once.
 * @param resolution - Browser refusal or exact Client activation result.
 * @returns Whether the still-pending request accepted this resolution.
 */
@Remote('resolveRequestRun') async resolveRequestRun( requestId: ApprovalRequestId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisResolveAck>

/**
 * Settle a direct panel run after this page loaded or failed its Client half.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity being settled.
 * @param resolution - Exact Client activation result from the acting page.
 * @returns The committed activation or its failure.
 */
@Remote('settleUserRun') async settleUserRun( agent: Agent, pluginId: CordisDynamicPluginId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisRunResponse>

/**
 * Stop the active run while retaining every Package version.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
@Remote('stopFromPanel') async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Replace the Host mirror of the Client inspect provider directory.
 * @param providers - complete Client provider manifest.
 * @returns null after accepting the manifest.
 */
@Remote('syncInspectManifest') syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null

/**
 * Claim one pending Client inspect query with its live result.
 * @param agent - Session that owns the query.
 * @param requestId - exact pending query identity.
 * @param resolution - provider result or structured refusal.
 * @returns whether this answer won the query.
 */
@Remote('resolveInspectQuery') resolveInspectQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck

/**
 * Frame-wide inventory, grouped as one row per stable Plugin.
 * @returns Source-free metadata for every process-local Plugin.
 */
@Remote('inventory') inventory(): DynamicCordisInventoryRow[]

/**
 * Read one Session's Host-rich state for inspection and result rendering.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns Plugin versions, active runs, Host fibers, and render failures.
 */
snapshot(agent: Agent): DynamicCordisSnapshotRow[]

/**
 * Read source-free context for an explicit `@pluginId` user gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity referenced by the user.
 * @returns The preferred modification base, or undefined when unavailable.
 */
reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined

/**
 * List source-free Plugin summaries owned by one Session.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns one summary per Plugin in creation order.
 */
listPlugins(agent: Agent): DynamicCordisPluginInspection[]

/**
 * Inspect one Plugin without returning Package source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - stable Plugin identity.
 * @returns version pointers, latest run, and all Package summaries.
 */
inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection

/**
 * Read one exact immutable Package and its Host and Client source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that owns the Package.
 * @param packageId - Exact immutable Package identity to inspect.
 * @returns Package metadata, source, and the Plugin's lifecycle pointers.
 */
inspectPackage( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, ): DynamicCordisPackageInspection

/**
 * Record a post-load render failure for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that rendered.
 * @param pluginRunId - Exact active run that produced the failure.
 * @param failure - Slot, message, and entry-retirement result.
 * @returns Null after recording or ignoring a stale report.
 */
@Remote('reportRenderFailure') async reportRenderFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: DynamicCordisRenderFailure, ): Promise<null>

/**
 * Report a Client guard rejection that happened after the Package completed activation.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity whose Client code was rejected.
 * @param pluginRunId - Exact active run that produced the rejection.
 * @param failure - Original guard message and stack.
 * @returns Null after reporting or ignoring a stale/startup failure.
 */
@Remote('reportClientGuardFailure') async reportClientGuardFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: CordisErrorDetails, ): Promise<null>

/**
 * Invoke an active Host method while rejecting stale Client runs.
 * @param pluginId - Stable Plugin identity that owns the method.
 * @param pluginRunId - Exact active run authorizing the call.
 * @param method - Registered Host handler name.
 * @param args - JSON argument delivered to the handler.
 * @returns The JSON result or a typed invocation failure.
 */
@Remote('invoke') async invoke( pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, method: string, args: JsonValue, ): Promise<DynamicCordisInvokeResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/extensions/cordis-host-runner/src/index.ts`](../../packages/extensions/cordis-host-runner/src/index.ts)

<a id="ctxinspector--inspectorservice"></a>

### `ctx.inspector` — `InspectorService`

Shared Host/Client service façade over the realm's source publisher.

```ts cordis-catalog
/**
 * Publish one JSON observation without waiting for Worker delivery.
 * @param topic - Domain-owned topic name.
 * @param payload - JSON value validated before it reaches the carrier.
 * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
 */
publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
```

Source: [`packages/experimental/inspector/src/index.ts`](../../packages/experimental/inspector/src/index.ts)

<a id="ctxjev--jev"></a>

### `ctx.jev` — `Jev`

Cordis service that resolves one pinned Jev provider per request.

```ts cordis-catalog
/**
 * Read the settings switch; `jev/enabled` announces each change.
 * @returns Whether Reflex decisions run, so callers can hide Reflex-only features while it is off.
 */
isEnabled(): boolean

/** Register the runtime owner of one capability's observed status.
 * @param id - Product capability identity.
 * @param read - Runtime status projection; connection probes never update it.
 * @returns Disposer removing this reader.
 */
registerCapability(id: ReflexCapabilityId, read: () => ReflexCapabilityState): () => void

/** Read provider identity and independently observed capability states without credentials.
 * @returns Current provider and capability status.
 */
@Remote readStatus(): ReflexStatus

/** Test a candidate without persisting configuration or modifying capability status.
 * @param input - Candidate endpoint/model and optional transient key; never returned or stored.
 * @param signal - Caller lifetime.
 * @returns Sanitized connectivity and real-decision results.
 */
@Remote async testConnection(input: ReflexConnectionInput, signal: AbortSignal): Promise<ReflexConnectionResult>

/**
 * Register a provider and return the disposer owned by the caller.
 * @param provider - Provider whose identity is unique in the registry.
 * @returns A disposer that removes only this registration.
 */
register(provider: JevProvider): () => void

/**
 * List provider metadata without exposing credentials or request data.
 * @returns Detached registered provider metadata.
 */
listProviders(): readonly JevProviderInfo[]

/**
 * Read the metadata of the provider a request would use, without performing I/O.
 * @param providerId - Requested provider; omission selects the current default provider.
 * @returns Detached metadata, or undefined when Reflex is off or the provider is unconfigured or not registered.
 */
providerInfo(providerId?: string): JevProviderInfo | undefined

/**
 * Resolve a request to a provider and effective model without performing I/O.
 * @param request - Host request and optional provider selection.
 * @returns Validated request with provider and model pinned.
 * @throws When the selected provider is unconfigured or not registered.
 */
resolve(request: JevRequest): JevSpec

/**
 * Open or keep alive a provider's transport; failures are reported, never thrown.
 * @param providerId - Provider to warm; the default provider when omitted.
 * @param signal - Caller cancellation.
 * @returns Whether the provider answered; false when Reflex is off, the provider has no transport to warm, or the request failed.
 */
async warm(providerId?: string, signal?: AbortSignal): Promise<boolean>

/**
 * Execute a typed decision, returning unknown when the provider is unavailable or invalid.
 * @param request - Host state and typed questions.
 * @param signal - Cancellation propagated to the caller.
 * @returns Validated result or a safe failure description.
 * @throws When the selected provider is unconfigured or not registered, or the caller cancels.
 */
async decide(request: JevRequest, signal?: AbortSignal): Promise<JevOutcome>
```

Source: [`packages/experimental/apus-dsh-jev-plugin/src/index.ts`](../../packages/experimental/apus-dsh-jev-plugin/src/index.ts)

<a id="ctxreflexlocal--reflexlocal"></a>

### `ctx.reflexLocal` — `ReflexLocal`

Host service exposing engine preparation; its Fiber owns the engine and runner. The provider registration lives in a nested `jev` dependency, so a Jev reload re-registers it without stopping the engine.

```ts cordis-catalog
/**
 * Read device support, preparation, and routing in one observation.
 * @returns the latest consistent snapshot.
 */
snapshot(): ReflexSnapshot

/**
 * Observe readiness until the signal aborts or the plugin unloads; changes between reads coalesce.
 * @param signal - observer lifetime.
 * @returns the current snapshot followed by each later change.
 */
follow(signal: AbortSignal): AsyncIterable<ReflexSnapshot>

/**
 * Select the given variant, else the variant of a paused or failed preparation, else the recommendation.
 * @param options - variant and download source.
 */
prepare(options?: ReflexPrepareOptions): void

/**
 * Make a tested downloaded variant active now, or prepare another one in the background while the active one serves.
 * @param variant - option to make active.
 * @param options - one advertised download origin used without fallback.
 */
select(variant: ReflexVariant, options?: Pick<ReflexPrepareOptions, 'downloadSource'>): void

/** Stop active preparation and keep the partial download. @returns after the work settles. */
async pause(): Promise<void>

/** Stop active preparation and delete the partial download. @returns after the work settles and the file is removed. */
async cancel(): Promise<void>

/**
 * Record the local engine as the chosen connection mode, removing a Jev `defaultProviderId` that names another provider.
 * @returns after the profile change and the choice are persisted.
 */
async chooseLocal(): Promise<void>

/**
 * Start the active model's runner, then route Jev decisions to the local provider; requires an active model.
 * @returns after the runner answers and the profile change is applied.
 */
async enable(): Promise<void>

/** Stop local routing, clear both notices, and stop the runner after the decisions in flight. @returns after it stopped. */
async disable(): Promise<void>

/** Clear `unacknowledgedAutoEnableAt` after a client showed it. @returns after the cleared state is persisted. */
async acknowledge(): Promise<void>

/** Clear `unacknowledgedSwitch` after a client showed it. @returns after the cleared state is persisted. */
async acknowledgeSwitch(): Promise<void>

/**
 * Delete one variant, disabling local decisions first when it is the active, enabled model.
 * @param variant - option to delete; omission deletes every model.
 * @returns after deletion.
 */
async deleteModel(variant?: ReflexVariant): Promise<void>

/** Stop preparation and the runner, delete weights and partial files, then disable. @returns after deletion. */
async remove(): Promise<void>
```

Source: [`packages/experimental/reflex-local/src/index.ts`](../../packages/experimental/reflex-local/src/index.ts)

<a id="ctxreflexlocalcontroller--reflexlocalcontroller"></a>

### `ctx.reflexLocalController` — `ReflexLocalController`

Forwards each call to `ctx.reflexLocal`; a disconnected observer never cancels Host-owned preparation.

```ts cordis-catalog
/**
 * Read the current readiness without waiting for a change.
 * @returns the latest device, preparation, and enablement observation.
 */
@Remote snapshot(): ReflexSnapshot

/**
 * Follow readiness independently of Session and preparation lifetimes.
 * @param signal - Client observation lifetime.
 * @returns the current snapshot followed by each later change.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<ReflexSnapshot>

/**
 * Select the given variant, else the variant of a paused or failed preparation, else the recommendation.
 * @param options - variant and download source; omission uses configured origins.
 */
@Remote prepare(options?: ReflexPrepareOptions): void

/**
 * Make a tested downloaded variant active now, or prepare another one in the background while the active one serves.
 * Fails with `reflexLocal/preparing-other` while a different variant is being prepared.
 * @param variant - option to make active.
 */
@Remote select(variant: ReflexVariant): void

/**
 * Stop active preparation and keep the partial download for a later `prepare()`.
 * @returns after the work settles.
 */
@Remote pause(): Promise<void>

/**
 * Stop active preparation and delete the partial download.
 * @returns after the work settles and the file is removed.
 */
@Remote cancel(): Promise<void>

/**
 * Record the local engine as the chosen Reflex connection mode before any model is prepared.
 * @returns after the choice is persisted.
 */
@Remote chooseLocal(): Promise<void>

/**
 * Start the active model's runner, then route Jev decisions to the local provider; the engine rejects this without an
 * active model or when the runner cannot start.
 * @returns after the runner answers and the change is applied.
 */
@Remote enable(): Promise<void>

/**
 * Stop routing Jev decisions to the local provider.
 * @returns after the change is applied.
 */
@Remote disable(): Promise<void>

/**
 * Record that a client showed the pending automatic enablement, so later clients do not offer its undo again.
 * @returns after the cleared state is persisted.
 */
@Remote acknowledge(): Promise<void>

/**
 * Record that a client showed the pending background model switch.
 * @returns after the cleared state is persisted.
 */
@Remote acknowledgeSwitch(): Promise<void>

/**
 * Delete one model's weights, partial file, and records; deleting the active model stops its runner and keeps routing.
 * @param variant - option to delete; omission deletes every model.
 * @returns after deletion.
 */
@Remote deleteModel(variant?: ReflexVariant): Promise<void>
```

Source: [`packages/experimental/api-reflex-local/src/index.ts`](../../packages/experimental/api-reflex-local/src/index.ts)

<a id="ctxsystem3--system3service"></a>

### `ctx.system3` — `System3Service`

Unified runtime seam for the System3 pure policies.

```ts cordis-catalog
/**
 * Choose the route a request may take under the privacy policy.
 * @param candidates - Routes the caller could use, in preference order.
 * @param preferredId - Route to take when it is admitted.
 * @returns The admitted route, or the reasons every candidate was refused.
 */
route(candidates: readonly System3RouteCandidate[], preferredId?: string): System3RouteSelection

/**
 * Select recoverable evidence that fits the request's budget.
 * @param request - Candidate evidence items and the budget.
 * @returns The chosen items and what was left out.
 */
evidence(request: System3EvidenceRequest): System3EvidenceSelection

/**
 * Decide whether a turn may complete from its classified facts.
 * @param request - Supervisor facts and independent checks.
 * @returns The deterministic completion decision.
 */
supervise(request: System3SupervisorRequest): System3SupervisorResult

/**
 * Compare model advice with the deterministic decision without changing it.
 * @param modelAction - Action the model advised.
 * @param baseline - Deterministic supervisor decision.
 * @returns Agreement and disagreement facts for the ledger.
 */
shadow(modelAction: System3AdviceAction, baseline: System3SupervisorResult): System3ShadowComparison

/**
 * Validate one usage record before it enters the ledger.
 * @param record - Usage and cost of one call.
 * @returns The same record when valid.
 */
validateCost(record: System3CostRecord): System3CostRecord

/**
 * Add usage records into one total.
 * @param records - Validated usage records.
 * @returns Their sum.
 */
sumCosts(records: readonly System3CostRecord[]): System3CostRecord

/**
 * Read operational counters, free of user data.
 * @returns Current counters.
 */
snapshot(): System3ServiceSnapshot

/**
 * Record Jev advice beside the unchanged deterministic baseline.
 * @param session - Session owning the persisted decision.
 * @param request - Classified supervisor facts and independent checks.
 * @param signal - Caller cancellation.
 * @returns Committed, non-model-visible receipt.
 */
shadowDecision(session: Session, request: System3DecisionRequest, signal?: AbortSignal): Promise<System3DecisionReceipt>

/**
 * Read the latest projected receipt without calling Jev during replay.
 * @param session - Live or restored Session.
 * @returns Latest committed receipt, or null before the first decision.
 */
lastDecision(session: Session): System3DecisionReceipt | null
```

Types: [Session](session.zh.md)

Source: [`packages/experimental/system3/src/index.ts`](../../packages/experimental/system3/src/index.ts)

<a id="cordis-events"></a>

### `cordis/*` events

<a id="cordisdynamic-package--emit"></a>

#### `cordis/dynamic-package` — emit

One exact Plugin/Package activation is now live in the Host.

```ts cordis-catalog
/**
 * One exact Plugin/Package activation is now live in the Host.
 * @param pkg - stable plugin, immutable package, run identity, and label.
 * @mode emit
 */
'cordis/dynamic-package'(pkg: DynamicCordisPackage): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisdynamic-retract--emit"></a>

#### `cordis/dynamic-retract` — emit

One exact activation was withdrawn.

```ts cordis-catalog
/**
 * One exact activation was withdrawn.
 * @param retracted - plugin, package, and run identity.
 * @mode emit
 */
'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query--emit"></a>

#### `cordis/inspect-query` — emit

Request a live read-only query from the Client inspect registry.

```ts cordis-catalog
/**
 * Request a live read-only query from the Client inspect registry.
 * @param request - correlation, Session, provider, method, and JSON input.
 * @mode emit
 */
'cordis/inspect-query'(request: CordisInspectQueryRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query-resolved--emit"></a>

#### `cordis/inspect-query-resolved` — emit

Notify every Client that an inspect query has settled or been cancelled.

```ts cordis-catalog
/**
 * Notify every Client that an inspect query has settled or been cancelled.
 * @param resolved - exact query identity that is no longer answerable.
 * @mode emit
 */
'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run--emit"></a>

#### `cordis/request-run` — emit

A Client-bearing activation needs a browser page, and may require a user decision.

```ts cordis-catalog
/**
 * A Client-bearing activation needs a browser page, and may require a user decision.
 * @param request - correlation identity, owner, target version, mode, and approval requirement.
 * @mode emit
 */
'cordis/request-run'(request: DynamicCordisRunRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run-resolved--emit"></a>

#### `cordis/request-run-resolved` — emit

A pending Client activation request left the answerable state.

```ts cordis-catalog
/**
 * A pending Client activation request left the answerable state.
 * @param resolved - request identity and outcome.
 * @mode emit
 */
'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="jev-events"></a>

### `jev/*` events

<a id="jevenabled--emit"></a>

#### `jev/enabled` — emit

The Reflex settings switch changed; `loader/volatile-update` reaches only the Jev entry, so dependents listen here.

```ts cordis-catalog
/**
 * The Reflex settings switch changed; `loader/volatile-update` reaches only the Jev entry, so dependents listen here.
 * @param enabled - Whether Reflex decisions now run.
 * @mode emit
 */
'jev/enabled'(enabled: boolean): void
```

Source: [`packages/experimental/apus-dsh-jev-plugin/src/index.ts`](../../packages/experimental/apus-dsh-jev-plugin/src/index.ts)

<a id="system3-events"></a>

### `system3/*` events

<a id="system3context-prepare--parallel"></a>

#### `system3/context-prepare` — parallel

Await task-frame judgements already admitted for this step before capturing context-removal constraints. Later queued input is excluded; cancellation ends the wait without cancelling background frame work.

```ts cordis-catalog
/**
 * Await task-frame judgements already admitted for this step before capturing context-removal constraints.
 * Later queued input is excluded; cancellation ends the wait without cancelling background frame work.
 * @param agent - Agent whose claimed input established the finite admission batch.
 * @param signal - Context plugin lifetime and turn cancellation.
 * @mode parallel
 */
'system3/context-prepare'(agent: Agent, signal: AbortSignal): Promise<void> | void
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/system3/src/task-frame.ts`](../../packages/experimental/system3/src/task-frame.ts)
<!-- END GENERATED cordis-surface -->
