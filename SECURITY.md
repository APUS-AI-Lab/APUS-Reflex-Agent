# Security policy

APUS Reflex is experimental developer-preview software. It can execute model-generated code, load third-party plugins, access configured files and credentials, and make network requests. Do not treat it as a security boundary or run untrusted workloads with production privileges.

## Report a vulnerability

Please use GitHub's private vulnerability reporting form for this repository: <https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/security/advisories/new>. Do not open a public issue for an unpatched vulnerability or include API keys, session logs, model reasoning, personal data, or other secrets in a report.

If private reporting is unavailable, open the repository Security tab and use the contact method shown there. Include the affected commit or release, platform, a minimal reproduction, and the impact. Redact credentials and unrelated user data before sending.

## Data handling boundaries

- Context projection removes selected segments from a later Harness model request; it does not delete the original Session log or edit Codex's private history.
- Cache protection is an input and Session-prefix invariant. This project does not claim provider cache hits, cache isolation, or cost savings without provider-level evidence.
- Test fixtures and screenshots must use synthetic credentials and data. Never attach `.env` files, access tokens, private prompts, or raw logs containing secrets.

## Responsible disclosure

Maintainers will confirm receipt when practical, investigate with the smallest required reproduction, and publish a fix or mitigation when one is available. Because this is a developer preview, support and fix timelines are not guaranteed.
