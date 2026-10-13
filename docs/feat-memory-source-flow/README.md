# Read complete Continuum source text

English | [中文](README.zh.md)

## Summary

The [source-read overlay](../../apps/cli/config/examples/continuum/source-read.cordis.yml) adds the existing workspace-authorized Session tools to a configured profile. A model can follow Continuum's source references, read exact original text in bounded pages, and continue using each page in its next request. This is a separate explicit opt-in; the Continuum live switch does not revoke these tools.

## Table of Contents

- [Enable source reads](#enable-source-reads)
- [Read and continue](#read-and-continue)
- [Verification](#verification)
- [Limits](#limits)
- [Dev Note](#dev-note)

<a id="enable-source-reads"></a>
## Enable source reads

Start from a built checkout with a working model profile. Add `--patch apps/cli/config/examples/continuum/source-read.cordis.yml` to the existing `pnpm dsh --profile headless` command. Keep the profile's existing Continuum/model patches when using automatic recall; this overlay neither configures a model nor enables Continuum admission.

The overlay retains the default 8192-byte event-read result budget. Remove the overlay and restart the profile to remove its tools. Exact source reads work with the default disabled full-text index; `session_search` and `session_event_search` require a separately enabled index. See the [tool package](../../packages/session-query/tool-session-query/README.md) for all tool and configuration semantics.

<a id="read-and-continue"></a>
## Read and continue

Ask the model to follow a recalled `sources` entry with `session_event_read`, supplying its `sessionId` as `session_id` and `eventSeq` as `seq`. To retrieve original message text, select `view: "text-block"` and its text `block` index. Continue with the returned `next_offset` and `sha256` until `next_offset` is null. The model receives ordinary persisted tool results; source text is not replaced by a generated summary.

A changed-event error requires restarting at offset zero. A workspace denial requires choosing an authorized source; specifying another session ID does not grant access. Full paging rules and exact JSON/text distinctions live in the [source-page reference](../../packages/session-query/tool-session-query/README.md#use-this-package).

<a id="verification"></a>
## Verification

The keyless Headless acceptance uses a configured recording model with real tools, persistence, authorization, and subprocess restarts:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/headless/tests/continuum-source-read.e2e.ts
```

The SDK scenario replays model tool calls against a fixed original event written through public persistence, preserving its actual digest:

```sh
pnpm run test:snapshot snapshots/sdk/sdk.snapshot.ts -t continuum-source-pages
```

<a id="limits"></a>
## Limits

This source-checkout overlay does not change default desktop/Web composition. It does not bind tool availability to the Continuum live switch, provide cross-workspace access, or automatically process all historical input. Bounded pages preserve the selected original text; complete task coverage and context scheduling are separate requirements in the [overall design](../feat-lossless-memory/design.html).

<a id="dev-note"></a>
## Dev Note

The [integration design](design.html) records this slice's composition and evidence scope.
