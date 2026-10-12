# R-04 local admission/status acceptance

English | [中文](r04-admission-status-queue.zh.md)

The built Web client was exercised through a real Playwright browser. While the first turn was held by the loopback scaffold, a second user submission produced the visible `Sending…` status in **16 ms**, below the 1,000 ms local admission/status budget. The composer was cleared and remained editable while the remote prompt stayed held.

The test is deliberately scoped to the first visible local response. It does not claim that Reflex routing, remote first byte, or the complete answer finishes within one second. The exact command and scope are recorded in [r04-admission-status-queue.json](r04-admission-status-queue.json).
