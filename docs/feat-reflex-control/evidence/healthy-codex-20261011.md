# Healthy Codex control attempts

English | [中文](healthy-codex-20261011.zh.md)

Two bounded, non-retried real Codex attempts used `gpt-6-sol-relay` with requested reasoning effort `low` on 2026-10-11. Both reached the fixed 150-second cancellation budget before normal completion. The natural CSV repair left its source and verifier unchanged and recorded one conservative `observe/inconclusive`, with no automatic steer. The literal unittest task used the semantic observation settings; its transparent relay observed one request and zero response bytes before cancellation, and no supervision event or steer occurred.

These failures do not establish a healthy long-task acceptance pass. They preserve evidence that the observer did not falsely steer while the native request remained silent. The literal trial's missing first byte locates the wait in the upstream request; it does not establish its internal cause. No thresholds, parser rules, or retry budget were changed to obtain a pass.

The earlier [natural CSV comparison](reflex-supervision-gpt6-diagnostic.natural.json) completed in 43.4 seconds with independent existing and held-out verification and zero automatic steers, but it is not a deployment-default long-task control. Current reports are [natural](healthy-codex-20261011-natural.json) and [literal](healthy-codex-20261011-literal.json). Raw commands, response bodies, credentials, and reasoning are excluded.
