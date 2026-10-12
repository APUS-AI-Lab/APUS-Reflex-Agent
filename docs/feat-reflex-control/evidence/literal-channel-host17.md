# Host17 literal verification channel

English | [中文](literal-channel-host17.zh.md)

The single real Codex trial failed with `aborted` at the fixed 150-second budget; the test process finished in 155.55 seconds. It used `gpt-6-sol-relay`, effective reasoning `low`, an existing standard-library unittest file and an explicit literal test invocation. There was no transport fault injection or native recovery. Only the initial native user-message item was observed; no command item reached the diagnostic parser. Its `missing-command` diagnostic describes a user-message item and is not a failed test-command parse.

The trial supplies no evidence about the command syntax, wrapper, cwd or verification-target extraction. Native telemetry was unavailable in the report. No syntax was broadened, and no semantic retry followed. An independent artifact check was not reached after the terminal-state assertion failed. The shortest next diagnostic is a non-mutating transport relay that records only HTTP status, request/first-byte/end timings, byte counts and native lifecycle categories, without retaining request or response bodies, tokens or command text. Another model call should follow that instrumentation rather than repeat the same unobserved wait.

During this trial, a concurrent `pnpm run constraints` automatically invoked an already-up-to-date dependency installation and postinstall helper/hooks. Its reported duration was 6.7 seconds; the report retains the log's final modification timestamp. No concurrent build was reported. This overlap is not proof of causation, and the timeout is not attributed exclusively to the model or provider.

[Sanitized report](literal-channel-host17.json) retains all observed events and hashes. Its post-run metadata correction explicitly sets `injection: false`, `recovery: false` and `controlledFault: null`: the previous report template confused an enabled semantic capability with a marketing fault injection. Observed events and outcome were not changed.
