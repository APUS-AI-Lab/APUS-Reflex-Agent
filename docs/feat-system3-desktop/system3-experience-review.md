# System3: a task workbench that takes initiative

English | [中文](system3-experience-review.zh.md)

This page proposes product interactions and records a review of the [original design](system3-native-v1.html#experience). All new experiences remain proposed. The [interactive experience draft](system3-experience-v2.html) uses offline examples and calls neither Jev nor Harness. The initial audience is desktop users doing development, document processing, and sustained tasks.

## Direct execution: experience direction

System3 should make users feel that their task was promptly accepted, its handling is appropriate, its important constraints remain remembered, and failures have a next action. Users express a goal in natural language. The workbench keeps that goal, the current action, emerging results, and requests for participation together. Jev judgments appear through changes in actual actions; Harness turns those judgments into work that users can control, resume, and verify.

### One complete experience

The user says: “Upgrade the interface under our previous constraints. Leave production untouched and run regression checks afterward.” The input appears immediately as a task receipt; “Accepted” appears only after Host acceptance. When a choice is needed, the receipt says “Choosing how to handle this task.” Once the selection is adopted, it says “Pro selected,” followed by actual work. Fixed mode skips entry Jev. Interface feedback and backend completion remain distinct.

“Used: migration checklist” and two inspectable original constraints appear beside the response. Users can avoid explaining earlier agreements again while still inspecting sources or excluding future use. As material grows, a brief status says “Context organized”; its details show protected facts and retrievable original records. When information is insufficient, the workbench identifies the records actually retrieved, then continues.

When regression checks fail, their evidence stays visible. Jev suggests reading error details from legal diagnostic candidates. After System2 actually reads them, the interface says “Failure log obtained,” followed by a repair result. When a code specialist is needed, the task records a handoff: its responsibility, actual activity, and available results. Results return to the parent task for integration. Users can stop the entire task or, where supported, stop the specialist independently.

After time away, users first see a change summary: “The plan was updated; one regression check still fails.” Goal shows explicit acceptance items rather than an estimated percentage. After restart, task material can be recovered while execution says “Waiting for you to resume.” Work continues only after explicit resumption. Follow-ups describe actual changes instead of periodically repeating “Still working.”

### How the experience is produced

| Feeling | Interface expression | Actual mechanism |
|---|---|---|
| Takes initiative | After acceptance, actual action starts promptly; important route choices update in place | Native admission, bounded Jev selection, and owner adoption; no artificial display delay |
| Understands the task | A suitable skill or specialist starts the corresponding work | Actual candidate descriptions, Skill injection, and native delegation; no fabricated Jev reasoning |
| Remembers | Earlier constraints and their sources are inspectable beside the task | Scoped retrieval, actual context injection, protected compaction, and original-record retrieval |
| Recovers | Failure stays visible, followed by the next diagnostic evidence and new results | tool/result, bounded evidence selection, and System2 diagnosis; no blind replay of writes |
| Remains controllable | Stop, Goal pause/resume, and next-turn mode remain reachable | Host confirmation and explicit effective timing; cancellation acceptance and settlement are distinct |
| Stays quiet and reliable | Ordinary choices occupy one line; changes, blockers, and risks expand | Status aggregation within one task, event deduplication, and change summaries |
| Feels complete | Openable results and acceptance evidence arrive item by item | Actual artifacts, nonempty required checks, and independent verification; output alone is not completion |

## Interface structure and feedback levels

Keep one native Conversation. The left side remains task/session navigation; the center holds the goal, conversation, and important changes. The right side reuses the existing sidebar slot to switch among “Results, Context, Goal, Records.” Extend the existing model selector near input instead of creating a routing control center. Narrow windows place right-side content beneath the task while keeping primary actions near input.

The default view answers four questions: what is happening, what results exist, what remains, and what can I do? A second level shows the skills, memories, specialists, and data destinations actually used. Only the third level shows suggestions, adoption, requests, outputs, and supply sources. Scores, protocols, and candidate versions remain in diagnostic details.

“Jev quick decision” can appear as an expandable product identifier beside the handling method. Normal entry selection uses one status line. Skill inclusion, diagnostic changes, specialist handoffs, and waiting for input leave short persistent change records within the task. Every Jev call does not need a new card.

Results should update as real artifacts arrive: plan drafts, file changes, and test reports become individually openable. Unverified drafts disclose their status; empty results never contain fabricated reports. Persistent in-app task state carries background results, while transient operation outcomes use shared Toasts so missing a brief notification does not leave users unable to find the result.

## Specific changes to the original draft

The dropdown demonstration at original lines 145–148 and render at lines 236–238 show four stages at once. They are useful for checking recorded facts but do not let users experience progress. Section 5 should begin with a complete task journey, retaining state auditing in details. The existing architecture and truthfulness constraints remain design inputs.

| Change | Priority | Original location | Experience to verify |
|---|---|---|---|
| Task submission receipt, current action, and first real output | P0 | #experience, lines 145–147 | Users avoid duplicate submissions and distinguish submitted, accepted, adopted, and streaming |
| Effective feedback for mode changes and stopping | P0 | Lines 142, 152 | Changing mode during execution explicitly affects the next admission; stop settles and preserves actions already taken |
| Current Goal gaps and resumption entry | P0 | Lines 94, 155 | Users distinguish waiting for input, budget stops, pause, and execution not resumed after restart |
| Actual skills and inspectable constraints | P1 | Lines 89–91, 148, 154 | Sources open; loading and request inclusion differ; exclusion scope and timing are confirmed |
| Actual direction changes after failure | P1 | Line 92 | Users see failure evidence, the next evidence, and actual reads instead of generic “self-repair” |
| Specialist handoff and results area | P1 | Line 93 | Each child task has specific work; partial results differ from final integration |
| Quiet follow-ups and complete usage | P1 | Lines 95, 106, 156 | Only actual changes are reported; usage includes Jev, summaries, failed retries, and specialists |

## How Jev capabilities enter the experience

Jev choice selects among legal candidates; score assesses local relevance or ordinal levels; noul judges bounded propositions. Each node chooses protocols according to need, without extra calls simply to display all three. Protocol scores remain uncalibrated and cannot become “task success probability” or grant additional permissions.

| Node | What the judgment actually changes | User experience | Adoption requirements |
|---|---|---|---|
| Entry | This turn's model or permitted handling path | Users need not select a model every time; handling is inspectable | Legal candidates, human intent, input admission, and effective model selection |
| Skill | Task instructions used in the next request | A professional method is already helping | Sourced text, version, Scope, deduplication, and actual request association |
| Memory | Relevant history placed in the next request | Constraints need not be repeated; original statements are readable | Readable scope, actual injection, versions, and exclusion checks |
| Compaction | Small blocks kept verbatim, summarized, or retrieved on demand | Long tasks continue while important constraints remain visible | Native transaction, System2 summary, required-fact checks, and retrievable originals |
| Diagnosis | The next evidence worth reading | Failure leads to a directed action | Settled result, adopted suggestion, actual tool read; complex repair remains separate |
| Specialist | Which installed provider receives a permitted task | Suitable help takes over and returns results | Native parent/child ownership, cancellation, and result return; model aliases are not delegation |
| Goal/communication | Suggest continuing, waiting, or reporting an important change | Users know what remains; less idle looping and interruption | Goal revision, actual continuation, budgets, and independent checks; Jev does not mark completion |

## Where local 9B/27B belongs

Future general-purpose local 9B/27B models can act as a System2 Lead inside Harness: handling validated everyday local capabilities and local data, generating work arrangements, tracking tasks, and dispatching specialists through native subagent services. Jev supplies bounded candidate judgments at entry and intermediate nodes. Lead performs complex generation and orchestration. Harness remains the only owner of execution and state.

Users could then see an actual “Processing on this device” location, concrete local results, and the permitted materials sent out during specialist handoffs. Both diagram and interface must distinguish the execution domains of Jev decisions, Lead, and specialists/cloud models. Self-hosted 9B does not mean device-local; an in-process child Agent does not mean a local model. Until validated, local Lead remains an evolution capability; existing Flash/Pro must not be renamed to imply it exists.

## State, interfaces, and reuse requirements

The proposal retains the original interface drafts. Client consumes Host projections and durable events; transient request state comes from the same request owner. Reconnection restores facts and fills history gaps without calling Jev again. Task state associates with input/turn/step; a late old decision cannot overwrite the current task.

| Interaction | Required Host support | Failure and recovery |
|---|---|---|
| Submission and entry | Local submission/Host acceptance/entry-in-progress/settled states; actual adoption and request association | Admission failure keeps input; Jev timeout preserves a permitted baseline; missing history shows local unknown state |
| Auto/fixed | Durable mode revision and effectiveFrom | CAS conflict refreshes actual mode; an already started configuration stays effective |
| Context inspection | Sources, content versions, and actual request-inclusion receipts | An unreadable source preserves the task; exclusion affects only its explicit future scope |
| Compaction/retrieval | Summary distinct from actual replacement; protected-fact list and retrievable sources | Failed checks prevent replacement; missing originals are disclosed |
| Specialists and stopping | Parent/child run, actual state, cancellation acceptance, and settlement | Partial results remain; cancellation does not undo external writes already performed |
| Goal | Phase and activation, required checks and evidence, actual continuation | Restart disarmed state is not running; automatic completion is not promised before budget and verification support exists |

The current entry decision receipt is written only after the call settles. The existing projection is just a Host latest shadow receipt and cannot support the complete Client task state. Current model-selection wire contains only lastUsed/next, without mode intent or effective timing. Implementation must add these native projections instead of Client guesses or simulated timers. See the [entry consumer](../../packages/experimental/system3/src/entry-routing.ts), [current projection](../../packages/experimental/system3/src/decision-projection.ts), and [selection types](../../packages/api/session-controller/src/types.ts).

## Motion and timing

Motion serves feedback, orientation, and state continuity. A task receipt echoes immediately; received, choosing, and adopted update in one place. Fast decisions never wait artificially or replay all four stages in sequence. A first result may use about 120–180ms of opacity/small displacement feedback; ordinary color feedback about 120ms; occasional detail opening about 180–220ms. These are starting interaction values for device validation, not model latency promises.

Do not animate each streamed token, notify on every decision, use looping glow to imply intelligence, animate keyboard navigation/focus, or invent percentages or “lossless” badges. Reduced motion switches instantly. Screen readers announce one current status while users can actively read complete records.

## File scope and verification plan

This delivery affects only design files and tasks in the same worktree. Product implementation retains the [original delivery scope](system3-native-v1.html#delivery): SessionController mode/admission projections, System3 Host/Client faces, native Conversation nodes and sidebar slots, and minimal Skill/Compaction/Goal/Subagent consumer extensions. Product copy belongs to typed locale dictionaries; reuse themes, Toast, Menu, and Tooltip. Create no second Conversation, AgentLoop, or task database.

Experience-draft verification covers all scenario progressions, auto/fixed applying to the next task, pause/resume, stopping settlement, source inspection and future exclusion, narrow screens, light/dark themes, keyboard access, and reduced motion. It proves example interactions only, not backend capabilities or end-to-end speed. Product implementation still requires actual entry/intermediate adoption, error/cancellation/concurrency/reconnection replay, keyless snapshots, both SDK projections, and relevant behavior tests.

Measure experience benefit through first useful results, task success, rework, repeated explanation, and understanding of important waits. Also record extra Jev latency, abstention, summary/retrieval, and complete task costs. A single SDK smoke does not establish real p50/p95; fewer Tokens do not imply lower cost. User tests can ask participants to find the current action, next step, and takeover control independently, then check their understanding of completion.

## Deeper interaction: retained tradeoffs

Jev's value comes from a few correct choices cumulatively reducing rework rather than more frequent judgments. Users can clearly feel initiative at entry, adjustment during work, and continuity of memory, while normal operation still leaves space for results. Each new node needs actual behavioral benefit; skip a judgment where rules suffice.

“Local control, specialist handoffs, and lasting memory” is an attractive direction, but 9B/27B cannot be assumed competent at every local tool task. Start with local task families that have explicit acceptance criteria, then expand Lead orchestration. Perceived reliability should come from understandable state, inspectable sources, available takeover, and completed work.

## Dev Note

This page is an unimplemented interaction proposal. Refine components, interface fields, performance, and experience-test criteria before implementation. Product-code Human Gate has not passed. See the [current handoff](../../tasks/feat-system3-desktop/handoff.md) for verification records.
