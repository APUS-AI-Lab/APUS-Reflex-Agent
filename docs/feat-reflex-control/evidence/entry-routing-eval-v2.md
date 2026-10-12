# Entry routing evaluation v2

English | [中文](entry-routing-eval-v2.zh.md)

The real Jev evaluation used 50 two-tier and 30 four-tier labelled tasks with the deployed `APUS-OpenJev-v1-9B-5949` configuration. Route-decision latency was p50 309 ms / p95 588 ms for two-tier and p50 317 ms / p95 405 ms for four-tier, with no thrown transport failures.

The result supports the route-decision part of the one-second experience contract. It does not measure local admission/status rendering, remote first byte, full answer time, or visible failure fallback; those remain separate R-04 checks.
