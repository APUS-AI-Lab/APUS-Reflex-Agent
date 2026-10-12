# Continuum + Reflex classic cases

English | [中文](classic-cases.zh.md)

These cases are the smallest scenarios that explain the product behavior and provide a repeatable acceptance map. Each case names the user-visible result and the evidence that must exist before a release claim.

## Original profile compatibility

A user sends a normal task with Continuum disabled or without Jev. The task completes through the original provider path, no `continuum/memory-record` is appended, and no `continuum-memory` request message is emitted.

Evidence: `packages/context/continuum/tests/service.spec.ts`, `packages/context/continuum/tests/admission.spec.ts`, and the keyless shipped-profile snapshot lane.

## Opt-in memory admission

A user enables the Reflex-only memory switch, selects a scope, and sends a factual message. The committed `user/message` becomes one immutable `continuum/memory-record` with the exact Session id and event sequence as its source. Generated recall messages are never admitted as new facts.

Evidence: `packages/context/continuum/tests/admission.spec.ts` and `packages/context/continuum/tests/durable-admission.spec.ts`.

## Restart and recall

The process flushes JSONL, exits, and starts a new Host. The new Agent resumes from the durable Session, folds the memory record, retrieves the bounded working set, and adds one model-visible `continuum-memory` message with source record ids.

Evidence: `packages/context/continuum/tests/durable-admission.spec.ts` and `apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts`, which runs both source and built shipped profiles across two real processes and inspects the provider request.

## Jev shadow and active selection

Shadow mode calls Jev and records a `continuum/memory-decision` while retaining the deterministic baseline. Active mode applies only the bounded selected ids and records the decision receipt. An unavailable or denied route retains the baseline and records the reason.

Evidence: `packages/experimental/continuum-jev/tests`, `packages/context/continuum/tests/context.spec.ts`, and the deployed Jev System3 E2E matrix.

## Constraint protection during context reduction

A historical user message contains explicit precision, safety, privacy, permission, or file-integrity requirements. Jev may classify the fragment, but the reduction step cannot delete an active protected constraint. The decision and the attempted projection remain auditable. An explicit current request that supersedes the earlier constraint reopens normal selection.

Evidence: `packages/experimental/system3/tests/reflex-context.spec.ts` and `packages/experimental/system3/tests/reflex-context.e2e.ts`; the strict real Jev scenario also checks an unrelated travel fragment and a fresh Host restore.

## Recoverable historical memory

After a topic switch or compaction, the user asks for a specific archived fact. Reflex search returns a bounded excerpt with a stable event/block reference; restore adds the original text as a `reflex-memory` message, keeps it marked as historical data, and never grants it execution authority.

Evidence: `packages/experimental/system3/tests/reflex-context.spec.ts` and the restart portion of the strict real Jev context scenario.

## Release evidence rule

A case is release-complete only when its focused behavior test, its negative control, and its real entry-path or provider evidence all pass on the same commit. A skipped test, a keyless test standing in for a real-provider test, or a component-only test is recorded as incomplete evidence.
