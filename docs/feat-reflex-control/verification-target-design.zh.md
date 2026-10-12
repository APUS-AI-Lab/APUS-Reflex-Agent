# 验证目标证据补充设计

[English](verification-target-design.md) | 中文

<a id="status-and-problem"></a>
## 状态与问题

实现新增了需显式启用的静态验证目标提取，真实 API 验收仍待完成。结构化采集器提取原生读取、列举、搜索与文件变更的类别和路径。Codex 可能把成功的 Python 或 pytest 执行分类为 `unknown`，导致语义反馈没有目标路径。按照当前反馈规则，没有已知验证目标的成功命令不能证明与 Goal 相关的验证已完成。

<a id="native-protocol-evidence"></a>
## 原生协议证据

工作区固定 Codex 0.153.4 生成的 schema 在命令执行 item 中提供 `command`、`commandActions`、`cwd`、`status`、`exitCode`、`aggregatedOutput`、标识符、耗时及可选插件元信息。`commandActions` 明确只是尽力解析，没有通用 argv、测试目标或断言结果字段。可选 `scriptPath` 指向第一方插件脚本，不是通用验证目标。Reflex 摘要不得包含原始命令、输出或查询。

现有 semantic/supervision/recovery 报告仅保留受限操作证据或操作类别元信息，没有原生命令封装。检查时，浏览器隔离 Codex home 的 `/private/tmp/reflex-ux-acceptance/codex-home/sessions` 下没有 rollout JSONL 文件。因此尚未核实真实通道中裸命令与 shell wrapper 的分布，没有查看用户默认 Codex 历史。下一次已经计划的真实 E2E 可仅记录封装枚举及计数来补齐证据，不记录命令文本。

<a id="proposed-extraction"></a>
## 拟议提取方式

在 provider 进程中复用已锁定的 `@yarnpkg/parsers` 3.1.0 静态 `parseShell`。webworker runtime 已使用它；其 `dsh-shell-parser-only` 构建插件选择 shell 入口，排除无关的 Syml grammar。Codex provider 声明自己的直接依赖，使用公开根导出，不导入实验性 worker 或 parser 私有子路径。该 parser 提供 shell AST 而不执行命令；仍需定向拒绝测试核实其语法范围及字面量与 glob 的区分。解析不得执行代码、展开变量、查询环境或读取文件。解析前施加部署可配置的命令长度预算，提取后继续使用既有操作数量和路径预算。

配置 `evidenceSummary.verificationTargets: { maxCommandChars: 4096 }` 后，只接受单个字面量 `pytest <file.py>`、`python -m pytest <file.py>` 或 `python -m unittest <file.py>` 调用，也支持 `python3`。文件目标限定为 ASCII 字面量，所有选项和节点选择器均不支持。拒绝赋值、展开、替换、管道、重定向、命令串联、glob 目标和未知选项。任意 Python 脚本仍属于普通执行：脚本名称或退出码为零不能证明它执行了验证。

POSIX 支持必须覆盖裸命令，以及恰好一层已知 `sh`/`bash`/`zsh` wrapper，其 `-c` 或 `-lc` 参数后仅有一个字面量 payload。外层命令和 payload 分别解析。拒绝额外 wrapper 参数、嵌套 wrapper 和不支持的语法，不得反复剥离字符串直到出现可识别命令。首版不支持 Windows PowerShell/cmd 语法，不能将它们当作 POSIX 解析。宣称产品 POSIX 路径可用前，必须取得真实原生封装证据。

新增独立的结构化 `verification-target` 操作类别，不能伪造 read 操作。使用原生命令 cwd 解析字面量目标，仅保留工作区相对路径，省略工作区外或超预算目标。pytest node identifier、查询选择器与参数化值一律拒绝，不进入摘要。cwd 本身不能提供验证目标。先持久化实际准入的摘要，再经过既有工作区数据隐私策略发送。明确保留原生执行结果与省略状态。

<a id="feedback-and-limits"></a>
## 反馈与限制

反馈要求成功验证包含完整 `verification-target` 操作；只读测试文件不能证明改善。这类目标只有原生退出码为零才报告成功。模型可将准入的验证目标与未改变的 Goal 和要求对比。即便 pytest 目标相关且退出码为零，也只能确认观察到的那次调用结果，不能证明 Goal 的全部验收项均已执行并通过。不支持的命令、缺失目标、相关性不确定或工作区数据未获准入时，反馈继续保持不确定。该扩展不得改变权限、cache 前缀、用户消息或上下文投影。

<a id="change-and-acceptance-scope"></a>
## 修改与验收范围

实施需要新增 parser 依赖、provider 内部提取与配置、新操作类别、消费 schema/反馈、类型文档及持久化声明，并更新 TypeScript/Python 记录回放场景。当前 context/SDK 验收完成后需重新协调构建，不能仅通过更新文档宣称现有限制已经解决。

验收需要通过真实 0.153.4 通道覆盖字面量目标和 wrapper，报告仅保留封装结构；补齐不支持语法与含秘密参数的拒绝测试、工作区与截断及隐私测试、缺失或模糊目标反馈、双 SDK 记录回放，以及真实 pytest 或标准库 unittest 运行和独立产物验证。测试不能把真实 wrapper 替换成更简单的裸命令 fixture，也不能把任意 Python 脚本称作验证。
