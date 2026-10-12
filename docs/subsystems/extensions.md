# Extensions

English | [中文](extensions.zh.md)

The extensions subsystem lets an agent define versioned Cordis packages, run their host and browser halves, and query approved runtime metadata before writing code. Package lifecycle and sandbox behavior belong to the [`packages/extensions`](../../packages/extensions/README.md) package group.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md)

Source: [`packages/context/continuum/src/service.ts`](../../packages/context/continuum/src/service.ts)

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

Types: [Agent](core.md)

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

Types: [Agent](core.md)

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
 * Resolve a request to a provider and effective model without performing I/O.
 * @param request - Host request and optional provider selection.
 * @returns Validated request with provider and model pinned.
 */
resolve(request: JevRequest): JevSpec

/**
 * Open or keep alive a provider's transport; failures are reported, never thrown.
 * @param providerId - Provider to warm; the default provider when omitted.
 * @param signal - Caller cancellation.
 * @returns Whether the provider answered; false when it has no transport to warm or the request failed.
 */
async warm(providerId?: string, signal?: AbortSignal): Promise<boolean>

/**
 * Execute a typed decision, returning unknown when the provider is unavailable or invalid.
 * @param request - Host state and typed questions.
 * @param signal - Cancellation propagated to the caller.
 * @returns Validated result or a safe failure description.
 */
async decide(request: JevRequest, signal?: AbortSignal): Promise<JevOutcome>
```

Source: [`packages/experimental/apus-dsh-jev-plugin/src/index.ts`](../../packages/experimental/apus-dsh-jev-plugin/src/index.ts)

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

Types: [Session](session.md)

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

Types: [Agent](core.md)

Source: [`packages/experimental/system3/src/task-frame.ts`](../../packages/experimental/system3/src/task-frame.ts)
<!-- END GENERATED cordis-surface -->
