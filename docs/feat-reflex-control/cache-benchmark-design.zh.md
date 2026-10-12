# C-06 缓存配对验收

[English](cache-benchmark-design.md) | 中文

## 范围与矩阵

执行器使用正式 SDK profile、已构建 CLI、部署中的 pi-ai OpenAI 兼容 DeepSeek adapter 和真实 Reflex provider，不替换模型回答。两组对照按 off/on、on/off 顺序运行，每条件独立 workspace 和 Session，六份文件、用户提示、`deepseek-flash`、`low` effort、8192 输出 token 上限和工具定义保持一致。每个 Session 依次执行财务核对、暖续问，再由新的 CLI 进程使用同一持久 Session ID 恢复旧旅行：共四个 Session、十二轮。2026-10-10 的真实运行已完成；每轮 CLI 有 120 秒进程预算，Reflex 上下文判断使用部署的 15000 毫秒 deadline，不重试，所有失败保留。

“首次观察”指新 Session，不代表供应商缓存确定为空；供应商没有提供缓存清除或隔离保证。公共提示前缀可能已缓存，条件之间也可能互相预热。交错顺序减少顺序偏差，但两组仅供描述，不构成统计置信结论。暖续问有意复用同一任务历史；重启不被视为清空供应商缓存。Anthropic 与 OpenAI 不在此次付费调用范围，扩展前需确认凭据和可比较的已配置线路。

## 测量与验收

观测插件在真实生成派发时逐条记录完整规范化消息的哈希、每条原始供应商 usage 事件、首个文字/工具 delta 时延、完整流时长及错误。SDK 保留任务总时长、输出与持久事件。Reflex judgement 包含完整请求/响应、决策耗时及供应商实际返回的 usage；缺失用量为未知，不当作零。报告保留这些内容供独立计量，包括意外工具导致的额外请求。前缀比较覆盖重启恢复，差异必须调查，不能通过规范化抹去。这测量 Harness 消息一致性，不宣称不同 adapter 的供应商线协议字节完全一致。

执行断言独立用 Decimal 得到合计 1137.41，并要求暖续问订单 A 余额 835.12、输入哈希不变、四项记忆事实正确、所有既有请求消息哈希前缀不变。重启前保存各 Session JSONL 字节前缀，重启后核对 SHA-256；允许追加，禁止改写。检查投影只改未发送尾部，冻结恢复采用追加。如果没有任何合格片段实际被移出，应报告未发生处理，而非优化成功。同步部署上下文参数：15000 ms deadline、4000 字符请求、1024 字符片段、16 候选、`protectRecentMessages=4`、0.9 阈值、8192 字符恢复与 8 条搜索结果。Reflex 仍用配置默认 high，生成模型使用部署 low。on/off 只改变上下文审查模式，两者均提供记忆工具及缓存锚点；隔离的是语义投影开销，不是从基线移除整个能力和工具定义。

逐请求及整任务比较未缓存输入、缓存读取、缓存写入、输出与 Reflex 用量绝对值，以及首输出和完整任务耗时。最终请求计量采用持久 assistant usage，保留原始 usage 事件核对 adapter 转换及局部更新。只有供应商互斥计数完整时才报告缓存读取比例。价格未知就不计算金额收益；启发式提示变短或存在 cache-read 都不能证明净收益，负向配对与新增 Reflex 延迟也必须报告。切路由、压力压缩和其他 adapter 仍是独立缺口。

## 运行与产物

`cache-benchmark/run.py` 默认只打印固定计划，不加载 SDK、不调用模型。执行必须显式 `--execute`、提供已构建 CLI、未使用的输出目录，并等待 root 分配供应商独占时段。凭据静默加载到父进程环境。执行器创建唯一临时 workspace；每一轮通过独立的已构建 headless CLI 进程运行，第二、三轮显式传入同一 Session ID，第三轮因此是真实进程重启恢复；保留 workspace/session 日志供审计，不构建或安装依赖。

```sh
uv run --project python/sdk python docs/feat-reflex-control/cache-benchmark/run.py --exe apps/cli/lib/bin.js --output /private/tmp/reflex-cache-c06 --endpoint https://jev.example.invalid
```

仅在指定运行窗口加入 `--execute`。`report.json` 遵循[证据 schema](cache-benchmark/report.schema.json)，各条件 `*.requests.jsonl` 保存规范化输入哈希及流观察。材料均为合成数据，不记录凭据或授权请求头。可提交事件中的 reasoning/thinking 块和字段替换为哈希，请求 trace 只含哈希、不含原始消息；原始 Session 日志只留在私有临时 workspace，不进入提交证据。每个条件后保存局部报告；进程级中断可能只留下当前 trace 和持久 Session 日志而没有完成的报告行。四项无密钥负例检查覆盖错误的 A 余额、缺失记忆事实、reasoning 清理和原日志改写，语法、Ruff 与计划检查也通过。真实证据见 [C-06 报告](evidence/cache-c06-real.zh.md)；四个条件的全部断言通过。金额成本未知，四个条件共记录 16 条生成请求加有界 Reflex 判断；模型额外调用如实记录，不隐藏。

## 当前运行状态

第一次真实尝试在原进程复用第三轮 `cache-pair` Session，运行时正确返回“session already exists”，因此失败。第二次尝试虽然所有回答、工具、投影和前缀断言通过，但第三轮仍在同一进程执行；这不能作为重启验收，已保留为[公开诊断摘要（原始记录私有归档）](evidence/cache-benchmark-c06-attempt2-same-process.json)。修正后的第三次运行使用三个独立 headless CLI 进程，四个条件的答案、输入保护、持久前缀、请求前缀、路由、工具和真实 `remove` 投影断言全部通过，脱敏结果见 [C-06 报告](evidence/cache-c06-real.zh.md)。原始 Session 日志和模型输出只留在私有临时目录。
