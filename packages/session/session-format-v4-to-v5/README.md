---
description: "V4-to-V5 Session header promotion with released V4 physical framing and current-format admission: no event transformation, V5 delivery ownership."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore supported released V4 Sessions as V5 without rewriting stored generations. The V5 writer changes no event representation: it removes two log-only provider-selection event names that no released writer emitted, widens one Continuum admission source union, and adds optional payload properties. This package owns the header promotion, the untouched body stage, the native V5 codec, and target validation. Persistence owns file reads and successor publication.

## Table of Contents

- [Use this package](#use-this-package)
- [V4-to-V5 specification](#v4-to-v5-specification)
  - [Header and physical framing](#header-and-framing)
  - [Body preservation](#body-preservation)
  - [Inherited cut](#inherited-cut)
  - [Delivery generations](#delivery-generations)
- [Native V5 admission](#native-v5-admission)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the [catalog](../session-format-catalog/README.md) for complete restoration. Direct imports serve catalog assembly and persistence. No runtime invariant companion is published because this package registers nothing and owns no observable state: decoder, migration-stage, and validation state belong to one caller-owned restore. The package exports the adjacent migration, the released V4 source codec, the V5 codec, the V5 header validator, the artifact restorer, and the relationship checker.

```text
const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

Every restore creates independent stage state. [JSONL persistence](../session-persistence-jsonl/README.md) owns source reads, preparation, and verified exclusive successor publication.

<a id="v4-to-v5-specification"></a>
## V4-to-V5 specification

This edge promotes the header and forwards every event unchanged. It creates no event, message, or reference and remaps no coordinate.

<a id="header-and-framing"></a>
### Header and physical framing

| Input | V5 result | Preservation or refusal |
|---|---|---|
| Logical V4 header | `version: 4` becomes `5` | Released V4 header validation runs first; all other logical header fields remain unchanged. |
| V4 physical rows | Released V4 source codec decodes events and compact runs | Source framing and native V4 admission remain owned by the preceding package. |
| V5 physical rows | `releasedV5SessionFormatCodec` reuses released V4 framing and V4 row admission | This edge changes no physical representation. |

<a id="body-preservation"></a>
### Body preservation

The stage emits each source event and compact run unchanged, so sequence numbers, timestamps, payloads, references, and surface metadata stay byte-identical. The V5 payload differences are additive or removable without reinterpretation:

- `tool/provider-selected` already carried the V5 payload shape during V4. The removed `lsp/provider-selected` and `web/provider-selected` catalog entries never had a released writer: the deploy change that introduced provider selection appended `tool/provider-selected` directly, so no committed log carries the removed names and this edge needs no rename.
- `continuum/memory-index.data.admission.source` accepts `compaction` and `user-message`. A `compaction` record written under V4 remains valid under V5 without conversion.

<a id="inherited-cut"></a>
### Inherited cut

An unseeded artifact has cut zero. A seeded artifact without a source-supplied cut derives it from the last `session/end-seed` event carrying `data.inherited: true`; the stage refuses an unseeded artifact that contains such a marker and refuses a cut that disagrees with a supplied source cut. A missing cut with no marker is refused rather than treated as zero.

<a id="delivery-generations"></a>
### Delivery generations

`session-log-deepseek/delivery-accepted` watermarks name the generation whose coordinates they cover. The V4 checker recognizes only generation-4 markers, so this package validates generation-5 ownership itself: a V5 marker must name the artifact's own Session unless it sits inside a child's inherited prefix. Lower generations remain historical records and are not reinterpreted.

<a id="native-v5-admission"></a>
## Native V5 admission

`restoreReleasedV5Artifact` validates the V5 header, dense coordinates, unknown-required refusal with ignorable payloads retained, the inherited-cut marker agreement, the full V4-owned per-event checks (retired syntax, system-message fields, tool-result role, fork results, developer data, message sources), lifecycle relationships, and V5 delivery ownership. `assertV5Relationships` exposes the per-event and lifecycle portion for callers that already validated envelopes — JSONL persistence uses it after scanning a current-format file.

Every check delegates to the V4 edge rather than restating it. The only V5-specific additions are the header version and the active delivery generation.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `src/migration.ts` — header promotion, untouched body stage, inherited-cut derivation.
- `src/codec.ts` — V5 physical framing over released V4 rows.
- `src/validation.ts` — V5 header validation, restoration, relationship checks, delivery ownership.

<a id="further-exploration"></a>
## Further Exploration

- [Released Session format migrations](../../../.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) — stage protocol, codec reuse, and publication rules.
- [Session log versioning](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md) — when a structural change requires a version step.
- [Version and release status](../../../docs/session-format-status.md) — writer authority and the published-format record.

<a id="model-experience"></a>
## Model Experience

This package does not touch model requests, prompts, tool schemas, or model-visible text. It converts persisted history before Session restoration, so a migrated Session derives exactly the messages its V4 source already contained.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Removed provider-selection names** — the `lsp/provider-selected` and `web/provider-selected` catalog entries stay uninterpreted. A V5 reader treats them as unknown historical records; this edge does not rename them into `tool/provider-selected`, because no released writer produced them and inventing a payload mapping would attribute fields that the old names never guaranteed.
- **Converter coverage** — a V4 source whose body this edge cannot forward unchanged fails without publishing a successor or changing the source. Later fixes may widen accepted sources while their V5 output stays compatible.
- **Installed vocabulary** — restoration interprets only event types the installed Session package knows; other required types are refused and unknown ignorable payloads stay opaque.

<a id="dev-note"></a>
## Dev Note

None.
