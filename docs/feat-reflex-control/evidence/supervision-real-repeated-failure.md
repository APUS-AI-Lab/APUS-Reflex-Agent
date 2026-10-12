# Real repeated-failure supervision

English | [中文](supervision-real-repeated-failure.zh.md)

This isolated real-model run passed the bounded repeated-failure correction scenario. Codex intentionally ran the protected verifier three times while `result.txt` was wrong. Reflex observed the repeated failed evidence, issued an attributed `reflex-supervision` diagnosis, and the Codex process consumed that message. Codex then repaired `result.txt`, ran the verifier successfully, preserved `expected.txt` and `verify.py`, and ended normally.

The run used the `gpt-6-sol-relay` Codex relay with a 300-second task budget and completed in about 216.66 seconds. The report stores only event categories, outcomes, and SHA-256 artifact checks; it does not store commands, output, prompts, or credentials. This proves the repeated-failure path, including delivery and recovery, for this controlled scenario. It does not prove semantic drift detection for successful but unrelated work; that remains a separate pending acceptance case.

The report also records two sanitized native input lifecycle events for the supervision message: one `item/started` and one `item/completed` event at the same recorded timestamp. These events contain no message content. The fault run used an explicit test configuration of `semantic=false`, a 500 ms observation interval, a 30,000 ms stall threshold, and `yesProbability=0.7`; these values are not the release defaults. The completed native input makes Codex message receipt auditable, while the later diagnostic, file-change, and verification evidence shows the run continued after delivery.

This fault run has no semantic evidence summary and no structured `verification-target` action. Its successful verification therefore does not satisfy S-06's target requirement; the independent literal-channel run remains separate evidence for the target collector.
