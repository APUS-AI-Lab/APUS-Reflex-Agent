# 远端响应观测（2026-10-12）

[English](r04-remote-response-20261012.md) | 中文

四次探测使用发布 relay 配置和流式请求。其中三次 Fidoo relay 在 31.7–90.0 秒后出现传输级 `URLError`，内部 proxy 一次在 60.0 秒后超时；没有观测到首字节或完整响应。

这组结果属于传输待定，不是延迟通过，也不是模型质量失败。本地 admission/status 和路由决策测量仍是独立证据。报告未写入凭据或响应内容。详见[脱敏报告](r04-remote-response-20261012.json)。
