# F-01 Reflex 模型配置真实验收

[English](reflex-settings-real.md) | 中文

2026-10-10，在实际“Reflex 模型配置”页面完成一次真实配置链路。页面保存了 `low` effort，随后停止并重新启动 Web server；新进程重新加载后仍显示 `low`，真实任务请求也使用 `low`。之后恢复为部署默认的 `high`，保存接口返回 200，用户覆盖项被移除，最终 profile patch 只保留 locale 和主题设置。

规范模型 `APUS-OpenJev-v1-9B-5949` 的真实连接判断通过，观测耗时 3808 毫秒；刻意输入不存在的 `jev-latest` 得到预期失败，耗时 3010 毫秒，页面没有暴露凭据。网络观测确认 `settings/mutate` 与重启后的 `settings/describe`、`modelCatalog` 请求成功；API key 在界面保持掩码。

该证据覆盖 Web 配置页、真实连接测试、保存、跨进程重载和真实请求采用保存 effort。最终 Electron 包的独立用户目录、正常/安全模式和窗口级恢复仍属于 F-03，不能用本报告代替。

[脱敏 JSON 证据](reflex-settings-real.json)不包含 endpoint、token 或请求授权头。
