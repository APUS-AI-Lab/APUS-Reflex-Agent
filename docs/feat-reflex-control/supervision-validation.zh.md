# Reflex 监督验收

[English](supervision-validation.md) | 中文

真实测试使用隔离 workspace 和 Codex home、真实 Codex app-server 进程、配置的 Responses relay，以及真实 Reflex 模型。凭据从本地运行环境读取，不写入报告。验收必须同时取得原生 Codex `completed` 结果和独立 Python 验证；仅文件改变不能通过。

| 场景 | Codex 模型 | 结果 | 证据 |
| --- | --- | --- | --- |
| 人工重复失败夹具 | `gpt-5.6-sol-relay` | 失败：150 秒取消 | 已观察到三次失败、自动建议被接受、文件修复、验证成功和 Reflex 改善反馈，但未收到正常 Codex 终态。 |
| 自然 CSV 账单修复 | `gpt-5.6-sol-relay` | 两次失败：150 秒取消 | 第二轮未发送自动纠偏。原生 Codex 日志显示 HTTP 200 后 SSE 断流并触发原生响应重试；未收到正常终态。 |
| 人工重复失败夹具 | `gpt-6-sol-relay` | 失败：150 秒取消 | 已发生三次失败和建议接受，但结果文件仍然错误。包含验证文件名的读取命令暴露了测试分类器过宽的问题，被错误反馈为改善。 |
| 自然 CSV 账单修复 | `gpt-6-sol-relay` | 通过 | 43.4 秒正常完成；已有测试文件未变；已有验证与独立 Decimal、千位分隔符、退款用例通过；自动纠偏为零。 |

替代模型成功属于环境对照，不能证明已部署默认 `gpt-5.6-sol-relay` 的可靠性。对应报告为 `/private/tmp/reflex-supervision-gpt6-diagnostic.natural.json`。默认模型的失败报告保留在 `/private/tmp/reflex-supervision-attempt2.fault.json`、`/private/tmp/reflex-supervision-attempt2.natural.json` 和 `/private/tmp/reflex-supervision-attempt3.natural.json`。

第二份故障报告为 `/private/tmp/reflex-supervision-gpt6-fault.fault.json`。夹具现在匹配真实 `python3 verify.py` 执行，不再匹配任意文件名出现。反馈也要求存在成功验证证据，才能将过度自信的 Reflex 回答记为 `improved`。改善反馈与独立验收任务完成仍是不同事实。

自然任务暴露了过宽的干预条件：经过一段时间，加上新读取或文件修改证据，就可能触发无必要的 realign 建议。现在干预必须具备重复失败或重复相同操作及结果的证据。仅时间流逝而没有此类证据时，仍会调用 Reflex 并记录无法判定的观察。这既保护正常长模型请求，也避免观察器失明。

定向回归：subagent 服务、Codex 适配器和监督三个测试文件共 130 项通过。随后新增会话恢复回归，监督测试达到 41 项通过。该测试确认有限证据和 Goal 级干预约束在恢复后得到相同状态。最后的定向覆盖率门禁中，两个新增监督模块均达到 100%：语句 255/255、分支 197/197、函数 48/48、行 204/204，未添加排除或调整阈值。定向 oxlint 和此前 System3 Host TypeScript 检查通过。这些检查不代表全仓库穷尽覆盖。

随后一轮 150 秒 low-effort 诊断观察到原生 app-server 在 98.7 秒发出含 Reflex 监督标记的 `userMessage` 开始和完成事件。因此建议确实进入了原生 Codex 输入，但任务仍在修复前超时。原夹具的三次刻意分开的失败工具调用耗时 60–85 秒；这不是面向用户的延迟承诺。另行声明的 300 秒故障场景预算使用 `REFLEX_SUPERVISION_LONG_TASK=1`、`gpt-6-sol-relay`、`model_reasoning_effort="low"`，且没有人工 sleep。自然任务测试保留原预算。

时序调查发现了产品缺陷：首次反馈期限到达时，无法判定的结果会丢弃该次干预，后续验证到达后已无法回评。修复后保留该次干预，仅在新证据出现后再次判断；终态若证据未变化，则清理且不再请求模型。新成功验证现在可以产生后续改善评估。该实现的真实报告带有 `acceptanceRevision: feedback-reassessment-v2`；旧报告单独保留。

首次 300 秒试验仍以取消结束。原生 Codex 约在 80 秒消费监督消息，181.8 秒修复文件。另行执行的 Python 验证退出码为 0，验证文件哈希未变，结果与预期文件完全相同；这些事实不能替代原生正常完成。该试验使用旧反馈实现。其独立验证已保留在有限字段的[试验证据](supervision-trial-evidence.json)中。

最后一轮 300 秒试验使用反馈修复，并确认原生 reasoning effort 为 `low`。三次失败命令分别在 81.8、87.8、93.3 秒完成。自动建议获得确认，但取消前未出现原生监督 `userMessage`，没有发生修复，最终为 `aborted`。第三次失败后缺少原生活动，与原生模型请求尚未返回的情形一致；报告无法确定其内部原因。原生模型请求仍在等待时，`turn/steer` 获得接受不等于立即消费。此后未再重试。

仅通过 steer 处理重复失败的真实验收尚未通过。证据分别记录观察决策、投递确认、原生输入消费、独立产物验证和正常完成。替代模型的自然任务通过；上述仅使用 steer 的故障场景均未通过整项验收。最终报告为 `/private/tmp/reflex-supervision-gpt6-final300.fault.json`；前一轮长任务报告为 `/private/tmp/reflex-supervision-gpt6-long300.fault.json`。

无凭据 `reflex-supervision` recorded-session 场景通过已发布 SDK profile，使用真实 Goal、监督、subagent 生命周期、会话持久化和 SDK 通知链路。只有外部 Codex 执行与 Reflex HTTP 回答使用夹具。TypeScript 刷新和重放、Python built-runtime 录制和重放均通过。生成的快照保留三次失败验证、provider 实际消费的带来源建议、一次成功验证，以及 `intent → accepted → improved`，且不将自动建议写入人工 steer 记录。这些确定性覆盖不改变真实 provider 验收失败的结论。

独立的原生无活动恢复场景已通过，使用真实 Reflex API、包内本地 Codex app-server 和真实远端推理。回环代理刻意挂起首次模型请求，Reflex 随后授权中断；适配器等待 interrupted 终态，再在同一存活线程开始新一轮。Codex 写入预期文件、运行验证并正常完成。独立 Python 验证通过，预期文件及验证脚本哈希保持不变。这验证受控的传输停滞，不等于不可控生产故障或仅使用 steer 的重复失败场景。

最终 [v4 报告](evidence/native-recovery-real-v4.json)和[测试日志](evidence/native-recovery-real-v4.log)记录测试耗时 127.41 秒、一次恢复判断、四次普通证据判断，以及 `intent → continued` 恢复回执。V4 包含排队动作检查，拒绝过时的原生活动与人工/Goal 版本。早期 v2、v3 报告保留为中间证据。报告保留原始元信息：沿用的 `budgetMs: 150000` 字段不适用于本场景；实际执行的取消预算为 180000 毫秒，测试超时为 210000 毫秒。报告生成器已按场景修正预算，既有证据没有重写。

确定性测试分别覆盖中断回执未知、正常完成抢先、取消、等待副作用或审批、重试上限及不变观察去重。原生成功续跑本身不会将父 Goal 标记完成。浏览器验收与各 SDK 投影分别记录结果。
