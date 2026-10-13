# 前端合仓检查修复

[English](hygiene.md) | 中文

本批移除 34 处历史遗留的 unknown 类型断言，没有扩大 baseline，并修复 vendor-rescope 对运行时标识的误判。修改前，所有受影响的前端文件都与 origin/main 相同。输入保存回执的行为不变。

rescope 仅保留已登记的精确文件、字面量与预期出现次数；相同文件中的 import 和依赖仍接受检查。内置预设 ID、可执行文件名与带 scope 的包路径片段保留原值。解析结果保留额外字段及已有的接纳规则。测试使用符合实际结构的 fetch/DOM 依赖和直接构造的样例，没有用 any 断言替换。

文件范围：scripts/rescope-vendor.ts 及其测试、verify-no-unknown-casts 报告的 13 个前端文件、仅要求必要能力的启动失败文档读取接口，以及受影响的 README 配对。API 行为不变；读取接口只要求实际使用的 querySelector 能力，不要求完整 Document。

验证包括：rescope 与 unknown-cast 检查；涵盖错误文件、新增 import、重复例外的脚本负例；相关前端测试；前端 Node 类型检查；Ruff 与差异审查。没有扩大 baseline、删除迁移、排除整个文件、重命名包或改变生产生命周期。
