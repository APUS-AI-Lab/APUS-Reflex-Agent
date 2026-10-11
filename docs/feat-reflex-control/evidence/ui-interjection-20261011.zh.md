# 真实 Web 插话与 Codex 启动超时

[English](ui-interjection-20261011.md) | 中文

真实 Web 流程在 516 毫秒内选择 Codex 路由，创建并激活 Goal，并为 `ux-aging` 任务启动 Codex 委派。

委派仍在运行时，用户追加了中文字段和兼容性要求。Session 记录了 `subagent/steer` 和 `system3/interjection`，其中 `delivered: true`；界面也在当前任务卡中显示了这条追加要求。

Codex 没有产生 native 执行步骤。Web 监控在 120 秒显示启动超时提示，并允许用户在 229.338 秒停止任务。因此最终产物检查仍待完成；本次结果证明了排队、送达、超时和停止体验，不能作为 S-07 完成证据。

原始发票、历史 CSV 和已有测试文件的 SHA-256 保持不变。完整脱敏字段见 [JSON 报告](ui-interjection-20261011.json)。
