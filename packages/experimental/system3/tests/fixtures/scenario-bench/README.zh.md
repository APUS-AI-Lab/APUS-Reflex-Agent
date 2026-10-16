# Reflex 场景测速

[English](README.md) | 中文

这项测速在真实的 DeepSeek API 和已部署的 Jev 上，用同一批任务分别运行原生流程和带 Reflex 前置决策的流程，比较耗时、主模型步数和成功率。每个任务在独立工作区的全新 Headless 会话中运行，并在本轮结束后对回答或工作区做确定的成功检查。结果写入 [Reflex 前置决策研究框架](../../../../../../docs/research-reflex-predecision/README.zh.md#results)。

## 文件

| 文件 | 用途 |
| --- | --- |
| `driver.ts` | 构建工作区，在一份覆盖配置下运行选中的任务，每次运行输出一行 `RUN {…}` JSON |
| `native.patch.yml` | 原生组：随产品发布的 Headless 配置，使用 `deepseek-flash` 和原生 Skill 发现，不启用 Reflex |
| `reflex.patch.yml` | Reflex 组：原生配置加上 Jev（HTTP/2，每个并行请求一道题）、预取和 Skill 选择 |
| `suite.ts` | 按轮次交替运行各组，写入 JSON Lines 并输出汇总 |
| `analyze.ts` | 汇总一个或多个 JSON Lines 文件 |

## 任务

`project` 测试集在一个 40 个文件的 JavaScript 服务中运行，它是 Git 仓库，有暂存的改动，带两个未写 `whenToUse` 的 Skill（`commit-message`、`changelog`）。`personal` 测试集在一个不是仓库的个人文件夹中运行：日程、航班、开销、待办、邮件、会议纪要、联系人和证件，大多为中文。

| 测试集 | 类别 | 任务 id |
| --- | --- | --- |
| project | chat | `chat-capital`、`chat-joke` |
| project | facts | `facts-version`、`facts-refund`、`facts-pool` |
| project | locate | `locate-refund`、`locate-page-size`、`locate-stock` |
| project | changes | `changes-commit`、`changes-review` |
| project | skill | `skill-commit`、`skill-changelog` |
| project | edit | `edit-page-size`、`edit-refund-window` |
| project | chinese | `zh-version`、`zh-refund` |
| personal | p-chat、p-schedule、p-finance、p-todo、p-mail、p-notes、p-lookup | `p-chat`、`p-calendar`、`p-flight`、`p-expense`、`p-overdue`、`p-reply`、`p-meeting`、`p-contact`、`p-passport` |
| personal | p-edit | `p-add-todo` |

## 运行一次对比

教程：从凭据到记录结果的一次完整对比。命令在仓库根目录运行。

1. 把 `DEEPSEEK_API_KEY`、`JEV_ENDPOINT`、`JEV_MODEL` 和 `JEV_API_KEY` 写入根目录的 `.env`（Git 已忽略该文件），再用 `set -a; . ./.env; set +a` 载入 shell。不要打印或提交这些值。
2. 用 `SCENARIO_ONLY` 选择任务，取值是以逗号分隔的任务 id、类别或测试集；不设置时运行全部 26 个任务。每次运行都会调用两个付费 API，所以只选改动影响到的任务。
3. 按轮次交替运行两组：`SCENARIO_ONLY=edit,skill,p-edit node --import tsx/esm packages/experimental/system3/tests/fixtures/scenario-bench/suite.ts <out.jsonl> 3 native reflex`。每轮各组运行一次，两组承受相同的服务负载。至少跑 2 轮；修改和 Skill 任务的主模型步数在不同运行之间波动较大，跑 3 轮。
4. 阅读输出的汇总：各类别的总耗时、中位耗时、平均耗时之比、主模型步数和成功数，然后是 Jev 决策耗时、每次 Reflex 运行注入的预取项和 Skill 结果、失败、卡住的运行和逐任务耗时。`node --import tsx/esm packages/experimental/system3/tests/fixtures/scenario-bench/analyze.ts <a.jsonl> <b.jsonl>` 可以合并汇总多个文件，例如一批中的原生运行和改动之后的 Reflex 运行。
5. 把结果连同日期、任务选择和轮数记入研究框架的结果表；测得的行为发生变化时，同时更新包的 README。

运行期间不要修改源文件：每组在启动时加载 System3 源码，运行中途的修改会让同一份结果混入不同版本。

## 变量

参考：脚本读取的环境变量。

| 变量 | 读取方 | 作用 |
| --- | --- | --- |
| `SCENARIO_ONLY` | `driver.ts` | 要运行的任务 id、类别或测试集，以逗号分隔 |
| `SCENARIO_REPEATS` | `driver.ts` | 在一个 driver 进程内重复的次数；`suite.ts` 的轮次则让各组交替运行 |
| `PREFETCH_YES` | `reflex.patch.yml` | 预取的 `yes` 阈值，默认 `0.5` |
| `SCENARIO_STALL_MS` | `suite.ts`、`analyze.ts` | 耗时达到该值的运行列为卡住，不计入任何总计，默认 `300000`。DeepSeek API 偶尔会让一次主模型调用无报错地挂起 10–15 分钟。 |

## 运行字段

参考：每行 JSON 包含 `arm`、`pass`（轮次）、`id`、`suite`、`category`、`ms`、`success`、`steps`（助手消息数）、`tools`（按调用顺序的工具名）、`reflex`（预取结果和决策耗时）、`prefetched`（注入的候选 id）、`skill`（Skill 结果、选中的名称和决策耗时）、`stepTimes`（每一步的 `llm` 为从这一步开始到助手消息的时间，`tools` 为从该消息到下一步开始的时间）、`error`，以及 `answer` 的前 100 个字符。

## 迭代流程

教程：对一个前置决策机制做一次改动并测量。

1. 每次只改一个机制，这样结果的差异只有一个原因。
2. 改动涉及发给 Jev 的问题时，先运行只测决策的 Skill 评估：`SKILL_EVAL_FORMS='choice + yes confirmation (product)' SKILL_EVAL_THRESHOLDS=0.5 node --import tsx/esm packages/experimental/system3/tests/fixtures/skill-eval/eval.ts`，`SKILL_EVAL_NO_WHEN` 不设置时跑一次，设为 `1` 和 `half` 时各跑一次。措辞的细小变化就会改变 Jev 的回答，所以只有在标注集得分没有在改动相关的部分下降时才保留新措辞。
3. 用 `pnpm exec vitest run packages/experimental/system3` 运行包的单元测试。
4. 按上文用 `suite.ts` 运行受影响的任务，两组都跑，轮数相同。
5. 查看较慢的 Reflex 运行的 `stepTimes`：第一步 `llm` 时间长，说明注入的信息拉长了提示；修改之前出现额外的 `read` 或 `grep`，说明预取漏掉了文件；不需要 Skill 的任务出现 Skill 结果，说明发生了误选。
6. 记录结果，包括变慢的运行。

已部署的 Jev 网关拒绝选项超过 16 个的选择题（HTTP 422），并将并发请求限制在约 48 个（HTTP 429）；增加问题的改动要同时满足这两个限制。
