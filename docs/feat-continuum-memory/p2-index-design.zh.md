# P2 索引与积压设计

[English](p2-index-design.md) | 中文

## 目标

为 Continuum 检索提供可选的确定性倒排索引。索引可以从当前 `MemoryRecordStore` 投影完整重建，也可以在增量重建期间暴露待处理记录。现有线性扫描仍是默认路径，因此没有索引或没有 Reflex 的 profile 保持原有行为。

## API

- `MemoryRecordIndex.rebuild(records)` 从权威投影原子替换索引并清空积压。
- `MemoryRecordIndex.enqueue(record)` 将变更后的记录快照放入待处理队列。
- `MemoryRecordIndex.rebuildPending(limit)` 最多应用 `limit` 条队列记录并返回剩余积压。
- `MemoryRecordIndex.idsForTerms(terms)` 返回倒排 posting 的确定性并集。
- `retrieveMemoryWorkingSet` 接受可选 `index`，使用索引缩小评分候选，同时仍从权威 store 读取并过滤 active 记录，避免陈旧 posting 泄露记忆。

## 不变量

1. Session 日志和 `MemoryRecordStore` 仍是事实源；索引是可以删除的派生状态。
2. 相同记录输入产生确定性相同的索引，且不会修改记录。
3. 待处理数量通过 `pendingCount` 可见，有界重建明确推进积压。
4. 缺失或陈旧 posting 只会减少优化候选；调用方可以省略索引或重新构建。
5. 候选数、字节预算、排序、supersede/deactivate 语义和 scope 授权不变。

## 验证

单元测试覆盖确定性 posting、有界积压重建、完整重建等价性、陈旧停用记录过滤，以及带索引和不带索引的检索等价性。应运行 Continuum 包测试、host build 和 lint。
