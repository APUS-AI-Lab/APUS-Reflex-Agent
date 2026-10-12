# R-04 本地用户反馈性能

[English](r04-local-echo-perf.md) | 中文

通过真实 Playwright 浏览器测量构建后的 Web 客户端，输入覆盖短算术题、业务请求和长中文约束文本。首个可见用户消息回显在正常 CPU 下低于 1,000ms 本地预算（p50 57.779ms、p95 82.275ms、最大 82.275ms）；在 6 倍 CPU 降速下仍低于预算（p50 373.555ms、p95 523.978ms、最大 523.978ms）。

配套队列验收在挂起远端 prompt 时测得可见 `Sending…` 准入状态为 16ms。这些是本地交互指标，不包含 Reflex 路由、远端首字节或完整模型回答。完整样本和命令见 [r04-local-echo-perf.json](r04-local-echo-perf.json)。
