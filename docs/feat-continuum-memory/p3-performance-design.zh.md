# P3 性能与效果证据设计

[English](p3-performance-design.md) | 中文

## 目标

从同一批受保护的 A0/A1/B/C/U 真实模型请求中生成可复核指标：适用断言通过率、Jev active 与确定性 baseline 的候选一致性、请求 P50/P95 延迟、输入/输出 token 总量。评测结果先写入 JSON 证据，再由纯函数报告器计算，避免手工抄数。

## 口径

延迟是每个 variant/task 从开始到 DeepSeek 响应完成的墙钟时间；P50/P95 使用 nearest-rank，并记录样本量和每个变体的请求数。token 只统计 provider 返回的 usage 字段；Jev、索引、Session 写入和本地 CPU 未返回费用时写为 unknown，不填零。baseline 只用于候选选择对照，不重新声称它完成了模型任务。

## 通过条件

真实证据必须包含 20 个唯一 cell、11 个 applicable pass、0 failed，且每个响应为 `end_turn`。报告器对缺字段、重复 cell、空 latency 或负 token 拒绝。报告不把本地 stable-prefix 字节当 provider cache hit。
