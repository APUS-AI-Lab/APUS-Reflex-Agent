# feat-local-jev-mlx notes

English | [中文](notes.zh.md)

## 2026-10-14 · Local smoke measurements of the bundled llama-server

Environment: Apple M5, 24 GB unified memory, macOS 26 (Darwin 25.5). Runtime llama.cpp `b11118` (`e6ab7c1a4`, the same version the model author validated on Mac), official `llama-b11118-bin-macos-arm64.tar.gz`, sha256 `ca0ea3156257b21eeb11d0628f2baecd3928013a3d060e2e192042276e5b1f35`. Weights: Q8_0 of `APUS-Reflex-4B-GGUF` revision `191bfcb7`. This is only a smoke test, not P0: one machine, one run, synthetic state, no cloud comparison.

### Distribution

- The files `llama-server` needs at runtime are the executable plus 10 `@rpath` dylibs, 24 MB in total. The archive contains 18 symlinks, while `macos-runtime.ts` requires a runtime directory without symlinks, so packaging must materialize them as regular files by soname (for example `libllama.0.dylib`).
- The official binaries are ad-hoc signed. Re-signing ad-hoc with `--options runtime` makes loading fail with "mapping process and mapped file (non-platform) have different Team IDs". This confirms that every Mach-O must be signed with the same Team ID, which the release pipeline's existing per-file signing already satisfies.
- With only `disable-library-validation` on the main executable (simulating same-Team signing) and **without `allow-jit`**, the Metal device is visible and inference runs at GPU speed. Conclusion: llama-server does not need the JIT entitlement. Real Developer ID signing and notarization were not tested because this machine has no signing identity.
- A download from Hugging Face was interrupted midway (4.02/4.48 GB); a Range request with `curl -C -` returned **206**, and after completion the sha256 equals `5e57075a…` from `SHA256SUMS`. HF Range resume works.

### Performance

| Item | Measurement |
| --- | --- |
| Process start to `/health` 200 | 4.0 s |
| Prefill, Metal (`llama-bench` pp512 / pp4096) | 1,092 / 976 tokens/s |
| Prefill, CPU only | 100 / 95 tokens/s |
| Residency | RSS 3.4 GB (including mmap'd weights), phys_footprint 781 MB |
| Official example (118 tokens) | 209 ms, `close_ticket` 0.9995 |
| One request with 4 questions, state about 3.4k tokens, cold | First question 3.86 s (full prefill of 3,921 tokens); questions 2..4 0.58 / 0.59 / 0.84 s (`cache_n` 3,405, task segment only) |
| The same request again | 0.43–0.60 s per question |
| Next turn (one sentence appended to state) | About 0.43 s per question |
| Extra cost of `n_probs` 1024 | Negligible (59 ms for the whole request on a full cache hit) |
| 16-candidate distribution | Complete with `n_probs: 1024`, candidate mass 0.98 |

Key points:

1. The prefix cache works, but **the task segment comes after the state**, so every question recomputes the task segment and the state delta. The warm floor per question is about 0.4–0.6 s and depends on the task segment length (the 16-candidate Skill list is the longest).
2. The cold first question depends on state length, about 1 s / 1k tokens (base M5). Older or base chips will be slower; P0 needs measurements on M1/M2.
3. A 4-question request takes about 2 s warm and about 6 s cold. Whether this is acceptable depends on the measured range of cloud decisions; P0 must obtain that comparison.

### Not tested

Real Developer ID signing and notarization, Q4_K_M, 9B, M1/M2 and 8 GB models, real Harness decision point prompts, distribution comparison with the cloud, parallel processing of N questions across multiple slots.

## 2026-10-14 · P0 (partial): local latency of real System3 requests and noul rendering comparison

Environment: Apple M5 24 GB, llama.cpp b11118 Metal, 4B Q8_0, `-c 9216 -np 1`. Requests come from `docs/feat-jev-decision-kernel/completion-live-product-result-requirement.json` (real production requests for task.frame and completion.review with the cloud 9B answers), plus handoff.pack and entry.route requests constructed from the code. Script: `p0/strategies.py` in the session temporary directory.

| Request | Questions | Local total | Cloud reference |
| --- | --- | --- | --- |
| task.frame | 6 | 1.58 s (canonical noul) | 2.44 s for that call; labeled set p50 0.69–0.74 s |
| completion.review | 1 | 0.41 s | 1.50 s for that call; evaluation p50 0.51–0.55 s |
| completion.review | 2 | 1.12 s | 2.33 s for that call |
| handoff.pack | 4 | 1.21 s | 0.53–2.23 s |
| entry.route | 1 (6 candidates) | 0.56 s | p50 0.47 s, p95 1.21–1.34 s |

- About 0.28–0.56 s per question; the task instructions of these requests embed the goal and messages, the state prefix is short, and the prefix cache almost never hits (`cache_n` is mostly 0), so questions 2..N of the same request get no noticeable speedup.
- Conclusion: on the M5, latency is on the same order as the cloud and stays within every decision point's deadline (5–15 s). task.frame runs asynchronously in the background and does not block.
- **noul rendering decision**: the canonical `noul` primitive (yes/no candidates) tracks the cloud more closely than "rendering the true/false copy as a two-option choice": `correction` canonical noul 0.759 / two-option 0.020 / cloud 0.947; `acceptance` 0.964 / 0.844 / 0.989. The two-option rendering reverses the judgment.
- Local is 4B and cloud is 9B, so part of the numeric difference comes from model size.

## 2026-10-14 · Delivery form adjustment

- Standard DSH desktop does not load System3/Jev; the System3 desktop is a separate frontend repository that loads `deploy/system3/runtime.patch.yml` (including cloud Jev).
- Therefore: standard DSH uses an optional bundle (local is the only Jev provider); the System3 desktop switches between cloud and local through the engine's `cloudProviderId` and `configEditor`.
- The runner ships with the desktop primary runtime (no npm platform package); see [impl-spec.md](impl-spec.md).
