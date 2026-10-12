# Host17 字面量验证通道

[English](literal-channel-host17.md) | 中文

唯一一次真实 Codex 测试在固定 150 秒预算达到时返回 `aborted`，测试进程耗时 155.55 秒。模型为 `gpt-6-sol-relay`，实际 reasoning 为 `low`，任务使用已有标准库 unittest 文件和明确的字面量测试调用，没有传输故障注入或原生恢复。仅观察到初始原生 user-message item，没有命令 item 到达诊断解析器。该消息的 `missing-command` 诊断属于用户消息，不是测试命令解析失败。

本次没有获得命令语法、wrapper、cwd 或 verification-target 提取的证据，报告中的原生遥测不可用。未扩大支持语法，也未重新运行语义场景。终态断言失败后，没有执行独立产物检查。最短的后续诊断是使用不修改请求内容的传输中继，仅记录 HTTP 状态、请求开始和首字节及结束时序、字节数和原生生命周期类别，不保留请求或响应正文、token 或命令文本。应先补齐这些观测，再发起模型调用，不重复相同的无观测等待。

测试期间，并行 `pnpm run constraints` 自动触发了依赖安装与 postinstall helper/hooks，依赖报告为已是最新。该命令报告耗时 6.7 秒，报告保留其日志最后修改时间；没有报告并行构建。这项重叠不构成因果证明，不能把超时单独归因于模型或 provider。

[脱敏报告](literal-channel-host17.json) 保留全部观察事件和哈希。运行后元数据修正明确设置 `injection: false`、`recovery: false`、`controlledFault: null`：此前模板把启用语义能力误写成营销故障注入。没有修改观察到的事件和结果。
