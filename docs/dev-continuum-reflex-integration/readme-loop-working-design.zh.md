# README Loop Working 叙事设计

[English](readme-loop-working-design.md) | 中文

## 目标

让第一次打开仓库的用户在一分钟内理解 APUS Reflex Harness 的核心结果：Personal Agent 可以把一次性问答变成可恢复、可持续、可验证的 Loop Working。README 必须把“无限上下文”解释为工程能力边界，而不是承诺模型拥有无限 token 窗口。

## 阅读路径

1. 用户结果：Personal Agent 从一次响应进入持续工作循环。
2. 关键机制：无限记忆保存可恢复事实，无损输入保留原始意图，无损记忆保留原始 Session。
3. 决策模型：Reflex/Jev 提供低延迟专用决策；没有 Jev 时使用通用模型或原版 DSH 路径。
4. 真实架构：决策层选择路径，Harness 负责执行、权限、Session 和恢复，模型只接收有界投影。
5. 证据与边界：链接到真实 E2E、持久化回放、配置页和已知限制，不把开发预览写成完整产品承诺。

## 文件

- `README.md`：增加英文价值主叙事、双模型路径、Loop Working 和架构解释。
- `README.zh.md`：同步中文叙事和术语。
- `tasks/todo.md`：记录本次文档目标和验收结果。

## 验收

- 英中 README 都明确 Personal Agent、Loop Working、无限记忆、无损输入、无损记忆的关系。
- 明确 Reflex 专用模型和通用模型兼容路径，不暗示必须部署 Jev。
- 明确模型上下文仍然有界，系统通过记忆与投影实现可持续工作。
- 所有新增操作性描述都有当前代码、测试或现有文档链接作为证据。
- 通过 README gate、translation pairing、doc tests、doc-sync 和 diff check。
