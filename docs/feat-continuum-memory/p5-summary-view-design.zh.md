# 基于 Session 的摘要导航

[English](p5-summary-view-design.md) | 中文

## 目标与事实来源

Continuum 对从 `continuum/memory-record` Session 事件恢复的活跃记录提供确定性的摘要导航。Session 是唯一持久事实来源。树是可丢弃的投影，不是独立持久化的摘要事实，也不是模型生成的断言。

## API 与文件

`ContinuumMemoryController.summary(ticket, config)` 返回经过作用域授权、限制摘要文本大小的树。`zoom(ticket, path, config)` 将节点解析为当前带来源的记录。两者均拒绝过期读取凭据与关闭的开关。调用者可将展开记录的来源引用传给 `readMemorySourceEvents`，精确回读持久来源。控制器不返回未授权作用域的记录或已退役的版本。

`summary-view.ts` 负责投影与展开辅助函数，`policy.ts` 执行开关与授权检查，包测试覆盖当前版本和真实 JSONL 重启。`maxItemsPerLeaf` 限制叶节点成员数量；`maxSummaryBytes` 限制每个摘要的 UTF-8 字节数。树的元数据随语料增长；树是导航数据，不会自动注入模型请求。

## 验证与限制

测试比较重启前后的树，读取原始来源事件，排除被替代和停用的记录，执行精确作用域可见性与关闭开关检查，并验证多字节摘要限制。现有 Session 记录事件提供持久性，不需要格式生成或额外事件。模型生成摘要、持久化物化快照、后台合并以及服务端缓存计费仍属于独立工作。
