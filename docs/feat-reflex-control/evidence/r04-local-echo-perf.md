# R-04 local user-response performance

English | [中文](r04-local-echo-perf.zh.md)

The built Web client was measured through a real Playwright browser with short, business-sized, and long Chinese inputs. The first visible user-message echo stayed below the 1,000 ms local budget on normal CPU (p50 57.779 ms, p95 82.275 ms, max 82.275 ms) and under a 6× CPU throttle (p50 373.555 ms, p95 523.978 ms, max 523.978 ms).

The companion queue acceptance measured the visible `Sending…` admission status at 16 ms while the remote prompt was held. These are local interaction measurements; they exclude Reflex route time, remote first byte, and the complete model answer. Full samples and the exact command are in [r04-local-echo-perf.json](r04-local-echo-perf.json).
