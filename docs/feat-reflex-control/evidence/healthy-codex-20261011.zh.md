# 健康 Codex 对照尝试

[English](healthy-codex-20261011.md) | 中文

2026-10-11 使用 `gpt-6-sol-relay`、请求 reasoning effort `low`，运行两次有界且不自动重试的真实 Codex 尝试。两次都在正常完成前达到固定 150 秒取消预算。自然 CSV 修复没有修改源码或验证器，只记录一次保守的 `observe/inconclusive`，没有自动 steer。字面量 unittest 任务使用语义观察设置；透明 relay 记录一次请求，取消前响应字节为零，也没有监督事件或 steer。

这些失败不构成健康长任务验收通过，但保留了原生请求静默时观察器没有错误 steer 的事实。字面量试验缺少首字节，将等待位置定位到上游请求，无法确定其内部原因。没有为取得通过而修改阈值、解析规则或重试预算。

此前的[自然 CSV 对照](reflex-supervision-gpt6-diagnostic.natural.json)在 43.4 秒内完成，已有与独立保留验证均通过，自动 steer 为零，但它不是部署默认配置下的长任务对照。本次报告为[自然任务](healthy-codex-20261011-natural.json)与[字面量任务](healthy-codex-20261011-literal.json)，不包含原始命令、响应正文、凭据或思考内容。
