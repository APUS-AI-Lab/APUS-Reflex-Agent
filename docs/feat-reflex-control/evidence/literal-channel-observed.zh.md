# 带时序观测的字面量验证通道

[English](literal-channel-observed.md) | 中文

隔离的真实字面量 unittest 测试在 61.77 秒内通过，原生预算仍为 150 秒。测试使用仓库固定版本的 Codex app-server、实际 reasoning 为 `low` 的 `gpt-6-sol-relay` 及透明本地中继，没有故障注入或原生恢复。中继不修改请求和响应内容，仅保留时序、状态和字节数。

两次 Responses 请求均返回 HTTP 200，首字节耗时分别为 26.25 秒和 25.48 秒，两条流均正常结束。Codex 发出 POSIX shell 命令，存在原生 cwd、命令长度未超预算，原生动作分类为 `unknown`。既有严格解析器仍识别了受支持的字面量调用，记录 `finance/test_remaining.py` 对应的成功、完整 `verification-target`。Codex 正常结束，测试文件未变化，独立标准库 unittest 执行通过。没有修改解析语法或概率阈值。

本次证明所观察调用的字面量验证目标通道可用，不能确定旧 Host16 调用的不支持语法，也不代表语义纠偏通过。观察到的首字节耗时超过此前测试的 20 秒恢复阈值。语义实验现使用部署的 180 秒恢复阈值，总原生预算仍为 300 秒。[脱敏报告](literal-channel-observed.json) 与之前失败报告同时保留，不包含原始命令或响应正文。
