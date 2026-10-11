# R-04 本地准入/状态验收

[English](r04-admission-status-queue.md) | 中文

通过真实 Playwright 浏览器运行构建后的 Web 客户端。第一轮请求由 loopback scaffold 挂起时，第二次用户输入在 **16ms** 内显示可见的 `Sending…` 状态，低于 1,000ms 的本地准入/状态预算。输入框已清空并保持可编辑，远端 prompt 仍处于挂起状态。

本测试只覆盖用户首先看到的本地反馈，不表示 Reflex 路由、远端首字节或完整回答在一秒内完成。准确命令和范围记录在 [r04-admission-status-queue.json](r04-admission-status-queue.json)。
