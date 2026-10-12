# C-06 真实跨进程上下文缓存验收

[English](cache-c06-real.md) | 中文

2026-10-10，在构建后的 Harness CLI 和真实 DeepSeek provider 上完成四个独立条件、每个条件三轮、共 12 轮的真实验收。每个条件都由三个独立 CLI 进程完成：首轮新建 Session，第二轮复用同一持久 Session，第三轮在新的进程中使用同一 Session ID 恢复旧旅行事实。

四个条件为 `pair-0-off`、`pair-0-on`、`pair-1-on`、`pair-1-off`。生成模型固定为 `deepseek-official/deepseek-flash`、`low` effort，工具定义和消息前缀保持一致；Reflex 上下文判断使用部署的 15 秒 deadline。启用条件产生持久的 `reflex/context-projection`，其中包含 `remove` 和目标数量；关闭条件没有该事件。

所有四个条件的断言均通过：六份输入文件未改变，持久 Session JSONL 只追加且既有前缀 SHA-256 不变，后续模型请求前缀保持不变，provider/model/effort 路由固定，工具哈希固定，没有运行时错误；财务合计为 1137.41 元，暖续问的订单 A 余额为 835.12 元；新进程恢复后能回答旧旅行的旅馆、早餐、时间和地点，且不重读文件或联网。

该报告只提交脱敏后的摘要、哈希、事件类型和断言，不包含 endpoint、凭据、请求正文或 reasoning。`coldCacheGuaranteed` 为 `false`，`prices` 为 `null`：当前证据证明 Harness 请求前缀和本地持久化安全性，不证明供应商缓存一定冷启动、命中率或成本收益。原始 Session 日志和模型输出留在 `/private/tmp/reflex-cache-c06-real7`，未纳入仓库。

[脱敏 JSON 证据](cache-c06-real.json)保留四个条件的逐轮断言、上下文投影摘要、请求路由和持久前缀检查。
