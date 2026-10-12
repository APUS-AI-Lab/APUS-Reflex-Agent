# Remote response observation (2026-10-12)

English | [中文](r04-remote-response-20261012.zh.md)

Four probes used the release relay configuration and a streaming request. Three Fidoo relay attempts ended with a transport-level `URLError` after 31.7–90.0 seconds, and the internal proxy attempt timed out after 60.0 seconds. No first byte or complete response was observed.

This is a pending transport result, not a latency pass or a model-quality failure. Local admission/status and route-decision measurements remain separate evidence. Credentials and response content were omitted. See the [sanitized report](r04-remote-response-20261012.json).
