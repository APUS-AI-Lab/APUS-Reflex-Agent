# C-06 Real cross-process context-cache acceptance

English | [中文](cache-c06-real.zh.md)

On 2026-10-10, the built Harness CLI and real DeepSeek provider passed four independent conditions, three turns per condition, 12 turns total. Each condition used three separate CLI processes: a new Session for the first turn, the same durable Session for the second turn, and a new process with the same Session ID for the third-turn recovery of the old travel facts.

The conditions were `pair-0-off`, `pair-0-on`, `pair-1-on`, and `pair-1-off`. The generation route was fixed at `deepseek-official/deepseek-flash` with `low` effort, identical tool definitions, and stable request prefixes; Reflex context judgement used the deployed 15-second deadline. Enabled conditions emitted durable `reflex/context-projection` events with `remove` and a target count; disabled conditions emitted no such event.

All four conditions passed: the six input files were unchanged; durable Session JSONL was append-only with unchanged prior-prefix SHA-256; later model-request prefixes were unchanged; provider/model/effort routing and tool hashes were stable; no runtime errors occurred; the finance total was 1137.41 and the warm continuation reported order A at 835.12; the new process recovered the old travel hotel, breakfast, time, and place without rereading files or using the network.

The committed report contains only redacted summaries, hashes, event types, and assertions. It contains no endpoint, credentials, request bodies, or reasoning. `coldCacheGuaranteed` is `false` and `prices` is `null`: this evidence proves Harness request-prefix and local persistence safety, not a guaranteed cold provider cache, cache-hit rate, or cost benefit. Raw Session logs and model output remain in `/private/tmp/reflex-cache-c06-real7` and are not committed.

The [sanitized JSON evidence](cache-c06-real.json) preserves per-condition assertions, context-projection summaries, request routing, and persisted-prefix checks.
