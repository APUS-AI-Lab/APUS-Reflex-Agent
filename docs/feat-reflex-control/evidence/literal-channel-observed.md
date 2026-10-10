# Observed literal verification channel

English | [中文](literal-channel-observed.zh.md)

The isolated real literal unittest trial passed in 61.77 seconds with the unchanged 150-second native budget. It used the package-pinned Codex app-server, `gpt-6-sol-relay` at effective reasoning `low`, and a transparent loopback relay. No fault was injected and no native recovery was enabled. The relay forwarded request and response bytes without modifying their content and retained only timings, status and byte counts.

Both Responses requests returned HTTP 200. Their first-byte delays were 26.25 and 25.48 seconds; both streams ended normally. Codex emitted a POSIX shell command with native cwd, no over-budget command and a native `unknown` action. The existing strict parser nevertheless recognized the supported literal invocation and logged a successful complete `verification-target` for `finance/test_remaining.py`. Codex completed normally, the test file was unchanged, and independent standard-library unittest execution passed. No parser grammar or probability threshold was changed.

This confirms the literal verification-target channel for the observed invocation; it does not identify the unsupported syntax in the older Host16 run or validate semantic correction. The observed first-byte delays exceed the earlier test's 20-second recovery threshold. The semantic experiment now uses the deployment's 180-second recovery threshold while retaining its total 300-second native budget. [Sanitized report](literal-channel-observed.json) preserves the successful invocation alongside the earlier failed reports, without raw command or response content.
