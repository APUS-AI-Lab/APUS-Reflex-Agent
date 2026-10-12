# Entry routing v2 评测

[English](entry-routing-eval-v2.md) | 中文

本次真实 Jev 评测使用部署中的 `APUS-OpenJev-v1-9B-5949` 配置，包含 two-tier 50 题和 four-tier 30 题。路由决策延迟为：two-tier p50 309ms、p95 588ms；four-tier p50 317ms、p95 405ms；没有抛出传输失败。

该结果支持“一秒体验契约”中的路由决策部分，但没有测量本地 admission/status 渲染、远端首字节、完整回答耗时或用户可见失败回退；这些仍是 R-04 的独立检查项。
