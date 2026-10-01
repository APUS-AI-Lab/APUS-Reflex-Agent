# System3 G1 handoff

## TL;DR

- 用户已授权完整实现、真实测试与 litellm 服务器部署；统一正式 rc.2。
- 产品源码、Frontend、index、构建与部署由本会话独占。Jev 运维只在独立预检工作树审查。
- 入口/Skill、双 SDK、R1/R2/R3 固定复核及真实 Desktop/Linux 任务与恢复验收通过；双仓 PR 已创建。
- 用户追加手动部署授权；保留已验收产物，恢复本机 SSH 隧道并验证登录，Desktop 与默认浏览器已打开。
- 新增十二节统一架构与五图，核心为 Jev Native AgentLoop Harness 产品编排与参数化 Agent 执行对象；主目录 main 未修改，此工作树保留。

## 本轮交付物

完整文件清单与行数使用 `git diff --numstat system3-g1-foundation` 查看；新文件在提交后同样纳入清单。

| 路径 | 内容 |
| --- | --- |
| `packages/api/session-controller/` | 原子入口、总截止、恢复自动模式与回归 |
| `packages/experimental/system3/` | 真实 Skill 选择与原生指令注入、按请求关联的事实投影 |
| `packages/experimental/client-ui-system3/` | 本地接收、决策/采用/响应、专业指令状态、恢复自动按钮 |
| `snapshots/sdk/system3-entry-route/` | TypeScript 原生 Skill 消息与决策回放 |
| `scripts/snapshots/python-sdk-single-exe/` | Python System3 回放 |
| `docs/persistence-changes/2026-10-01-system3-entry-skill.*` | 三个新增事件的持久化类型确认 |
| `deploy/system3/` | 独立 systemd 发布、回滚、Desktop 依赖装配 |
| `apps/cli/tests/profiles/system3/` | 公开 CSV 任务与独立产物校验器 |
| `docs/feat-system3-g1/` | 实施与部署文档、最终证据；统一架构 HTML 589 行、英中来源清单及配对记录、浏览器证据和五组 SVG / 高清 PNG |
| `docs/feat-independent-harness/jev-native-dsh-native-plan.html` | 250 行；首图改为同一产品架构，保留历史正文并指向统一页 |
| `docs/feat-system3-desktop/system3-native-v1.html` | 492 行；首图采用同一产品架构，保留历史调用图 |
| `snapshots/sdk/agui-persona/system-prompt.expected.md` | 七段提示词对齐 rc.2；保留严格断言及 Session fixtures |

## 设计约束

Jev 8086 是结构化决策协议，8002 不能替代；实际 profile 显式 high。只向获准 provider 发送获准数据。入口取消不得准入；模型建议、Host 采用、真实响应和产物验证是不同事实。Skill 使用原生 skill-invocation 消息并以精确 message id 确认注入，不引入新的 Session generation。用户固定模型优先，恢复自动通过原生 Session API。

## 已发现的真实行为

- TypeSafe SDK 默认重试/日志不适用于此路径，需显式关闭；凭据解析也计入总截止。
- 桌面自己的 runtime 必须覆盖 Cordis、API 和插件完整依赖，不能混用 npm stock runtime。
- electron-builder 的资源过滤可遗漏 node_modules；afterPack 显式复制并验证物理闭包、27 个补丁和模块导入。
- PPT 插件需要 preview-manifest 与模板资源；只验证包文件存在不足以保证启动。
- Linux 容器内 bubblewrap 受宿主限制；独立非 root systemd 保留原生 sandbox，未关闭沙箱绕过问题。
- 当前 Mac 本地包未签名/公证；开发验收不能表述为已完成签名分发。
- 合成 finish/error/aborted 不能证明模型响应；运行态不能由历史入口采用记录推断。
- 发布健康通过才更新 previous；回滚按目标自身 service.unit 配对，成功后消费 previous。
- 本次回滚只验收同一修复源码的两个 release 之间切换、单元配对和会话恢复，不证明旧源码能读取新增 Session 事件。

## 下一里程碑任务清单

- [x] 完成最终源码门禁并提交固定审查点 system3-g1-reviewed-rc2；R1/R2/R3 独立固定复核关闭。
- [x] 部署已审查实现，真实完成 CSV 任务并以独立 oracle 核验产物。
- [x] 验证取消、恢复自动、刷新、服务重启与真实回滚后的会话/产物持久性。
- [x] Desktop 正常/安全模式启动、干净提交装配、实际自动 Skill/CSV 任务、安装后重启恢复通过。
- [x] 双仓 ship、远端 SHA 核验、记录 CI 和回滚状态。
- [x] 手动部署访问核对：确认最新 PR 无新增运行改动，恢复隧道、验证认证页面并打开实际入口。
- [x] persona expected 修复后的统一架构版本，独立 Harness Actions 已实际执行并通过；PR 尚未合并。
- [x] DNHM 定位文档的固定独立 Harness CI 已通过；不复跑冻结运行验收。
- [ ] 按统一架构逐项接入约束 / 恢复、失败取证等过程消费者，真实采用与成果分别验收。

后续产品范围：本地 9B/27B Lead、Jev 记忆压缩和完整专家/长期 Goal 编排未在本轮验收；候选 Skill 目录超限时保留原生路径。

## 分支/部署状态

Harness 分支 `feat-system3-g1`；已接受基础标签 `system3-g1-foundation`。Frontend 分支 `feat-system3-integration`。服务器现运行已审查标签对应的稳定发布，真实重启和回滚通过；精确 release ID、源码提交、任务和恢复证据见 docs/feat-system3-g1/deployment-final.json。应用仅监听服务器 127.0.0.1:18731，通过 SSH tunnel 与原生 cookie 访问。本机已安装 ~/Applications/xDAN System3.app，使用 ~/.local/bin/xdan-system3 或 ~/Applications/启动 xDAN System3.command 启动；凭据只在包外的受限文件内。Desktop pin 与任务证据见 desktop-acceptance.json。私有 Harness PR #13、Frontend PR #1 已创建，尚未合并。较早 Actions 因预算未执行；后续实际执行暴露 persona expected 错配，最小修复后三个本地 keyless 场景及远端独立 Harness CI 通过。Frontend Windows CI 已实际通过，固定证据见下文；后续提交应按各自固定 HEAD 核验。本地与真实运行证据不替代远端 CI。验收证据固定标签 system3-g1-acceptance-rc2，实际运行实现固定标签 system3-g1-reviewed-rc2。

## 冷启动 checklist

1. 先读本文件、[统一架构](../../docs/feat-system3-g1/architecture.html)、coordination-ack.md 与 tasks/todo.md；按当前事实和目标状态继续。
2. 检查双工作树状态、固定标签和 deployment-notes.md，保留所有未提交工作。
3. 检查服务器 current 与本地安装包 manifest，不能把预检当最终发布。
4. 只使用产品独立 BROWSE_STATE_FILE；不要干扰运维浏览器或 A100。
5. 按剩余验收清单继续，真实通过后更新本交接。

## PR 与 CI

[Harness PR #13](https://github.com/cryptoSUN2049/xDAN-System3-Harness/pull/13) 与 [Frontend PR #1](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/pull/1) 均已创建。DNHM 文档版本的 [独立 Harness 工作流](https://github.com/cryptoSUN2049/xDAN-System3-Harness/actions/runs/36833089898) 已由 REST 核对为 completed / success。该结果限于这一工作流及其固定提交，不代表 Frontend CI 或后续提交已通过；后续产品架构图文档提交另行核对。冻结验收资料不依赖后续交接提交；独立审查已只读核对已安装 app 摘要、源码 pin 与稳定服务指针/单元配对。

## 本次手动访问交付

本机 SSH 隧道由独立运维会话恢复，产品会话继续维护访问；双方未重复发布或重启服务。默认浏览器已通过私有启动 URL 打开 Web，现有 Desktop 已置于前台。实际页面与资源归属见 [deployment-notes.md](deployment-notes.md#manual-access-verification--2026-10-01)，启动和断线恢复见 [部署参考](../../docs/feat-system3-g1/deployment.zh.md#访问和隔离)。本次没有新增模型或任务验收，不扩展原有冻结证据的范围。

## 统一架构交付

主入口 [architecture.html](../../docs/feat-system3-g1/architecture.html)，融合 12 份既有 HTML、9 个 Markdown 资料族及 3 份旧 SVG。产品编排架构、当前、目标、部署及可展开执行流程五图与六场景均内嵌，无 CDN，可离线阅读；源码链接和下载资源需保留目录。来源见 [architecture-sources.md](../../docs/feat-system3-g1/architecture-sources.zh.md)，验证见 [architecture-verification.json](../../docs/feat-system3-g1/architecture-verification.json)。本轮不调用真实模型、不重新部署、不修改已安装 App；运行 pin 仍以冻结验收为准。

MAAH 是后续控制策略研究命题；N 是同一执行对象的数量参数，不指定拓扑或已验收并发数。记忆、取证、完整专家 / Goal、本机 Lead 和总收益对照仍需各自实现与验收。构建 / 文档检查仅验证此次文档与快照修复，不扩展原发布验收范围。

第 7 节补充 [DNHM 工作定义](../../docs/feat-system3-g1/architecture.html#dnhm)、Runtime Harness Generalization 及三组最小实验。独立运维负责近邻全文方法与代码比对；本会话只整合已交付的方法提议，不声明术语首创、已证新颖性、训练完成或实验收益。当前运行实现与 Frontend pin 保持冻结。

本次文档验证：test:docs 20/20、doc-sync 42/42、lint（包含 Host build）、Ruff check / format、diff 检查均通过，keyless SDK 三场景通过。浏览器为独占 architecture state，不操作产品登录或审查会话。

DNHM 文档补充验证：新增实验表键盘操作、390 / 1440px 展开布局与打印还原通过；七种屏宽和原交互回归通过，A4 共 19 页。test:docs 20/20、doc-sync 42/42、lint 通过；此处的 SDK / 四图原验收记录保留，未重复模型或部署测试。

## 产品架构主图修订

主图为 1280×900 的 Jev Native AgentLoop Harness 产品目标架构，9 业务组件展示用户任务、入口智能、编排总管与任务依赖、Agent 执行对象及能力、过程智能和记忆 / 成果反馈。原生步骤图保留在 system3-agent-loop.svg 与可展开 details；两图内嵌 ID 前缀独立，三页 CSS 显式保持深色图文字颜色。主图不增加全过程编排实现或论文结果；当前发布仍仅 entry / Skill 实测。用户要求本轮限图 / 文档和本地验证、固定提交，运行源码与部署保持。

本次主图修订验证：test:docs 20/20、doc-sync 42/42、lint、Ruff check / format、diff 检查通过；两 SVG 技能 self_check、172 个本地引用、三页内嵌颜色 / ARIA / ID、七种屏宽与五个折叠区通过。两 PNG 为 2560×1800 / 2560×3520，独立审查确认图像一致。A4 21 页，第 4–5 页完整呈现新两图。本轮固定提交并更新既有 PR；新提交远端 CI 待按固定 HEAD 核验，前述成功结果限于此前提交。未重复运行或部署验收。

### 本轮图示修订文件

| 路径 | 行数 / 格式 | 内容 |
| --- | --- | --- |
| `docs/feat-system3-g1/architecture.html` | 589 | 产品主图、流程 details、演进与范围 |
| `docs/feat-independent-harness/jev-native-dsh-native-plan.html` | 250 | 首图与内嵌颜色同步 |
| `docs/feat-system3-desktop/system3-native-v1.html` | 492 | 首图与内嵌颜色同步 |
| `docs/feat-system3-g1/diagram/system3-fusion.svg` | 51 | 9 组件产品目标架构 |
| `docs/feat-system3-g1/diagram/system3-fusion@2x.png` | PNG | 2560×1800 新主图 |
| `docs/feat-system3-g1/diagram/system3-agent-loop.svg` | 119 | 20 节点原生执行流程 |
| `docs/feat-system3-g1/diagram/system3-agent-loop@2x.png` | PNG | 2560×3520 流程 |
| `docs/feat-system3-g1/qa/product-architecture.png` | PNG | 实际内嵌主图截图 |
| `docs/feat-system3-g1/architecture-sources.md` | 70 | 英文来源与图示范围 |
| `docs/feat-system3-g1/architecture-sources.zh.md` | 70 | 中文配对来源 |
| `docs/feat-system3-g1/architecture-sources.i18n.yaml` | 25 | 配对确认 |
| `docs/feat-system3-g1/architecture-verification.json` | 483 | 本轮验证与保留证据范围 |
| `tasks/feat-system3-g1/architecture-plan.md` | 61 | 设计计划与 Review |
| `tasks/todo.md` | 230 | 任务完成状态 |
| `tasks/lessons.md` | 112 | 用户纠正与防重犯规则 |
| `tasks/feat-system3-g1/handoff.md` | 117 | 冷启动与交接 |

## 后续 CI 与过程恢复设计

产品主图固定版本的 [Independent harness CI](https://github.com/cryptoSUN2049/xDAN-System3-Harness/actions/runs/36857821137) 实际执行并成功，图示任务已完成。Frontend 原预算阻塞解除后，Windows CI 实测暴露 README 下载断言与跨平台路径夹具两项问题；产品会话已统一修复并补齐固定自有 Harness 的 Windows 装配链，最新固定 head 的 Windows CI 已完成并成功，证据见下文。详见 Frontend `docs/feat-system3-integration/ci-recovery-plan.md`。服务器与已安装 Mac App 仍使用 reviewed / acceptance 标签对应版本，本轮无模型调用或重新部署。

新增 [process-recovery-plan.html](../../docs/feat-system3-g1/process-recovery-plan.html) 为待确认设计：仅原生只读文件不存在错误，Jev 在定位输入 / 请求明确输入 / 弃权间选择，由原生 pre-step 验证状态并提交精确指令注入；不直接重放工具，不扩大权限。前端分别展示观察、决策与采用事实，不把采用等同任务恢复成功。原生大脑、确定性规则和 Jev 三组对照同时评测任务质量、总耗时与成本。新增运行实现须先取得用户对该具体设计的确认；未修改运行代码。

设计 HTML 已做 SVG self_check、8 个本地引用、ARIA/ID、1440/390px 浏览器与图像检查；doc-sync 42/42 通过。文件、任务和本交接随同文档提交，当前过程消费者状态始终为“尚未实现”。下一步等待用户对具体恢复设计的确认，再进入实现；Frontend CI 故障已关闭。

## Windows CI 最终交接

[Windows PR CI](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/actions/runs/36872088417) 已实际成功：原生测试 173 文件通过 / 2 跳过，1563 项通过 / 4 跳过；固定私有 Harness 源码构建、7 个自有包 / 27 补丁装配、Electron HTTP 200、三种缩放 UI、开发安装包和隔离应用工作区 / 会话创建通过。固定源码与步骤、产物 ID / 到期时间 / GitHub API 摘要集中于 [review-regression.json](review-regression.json) 的 windowsFrontendCiAcceptance。摘要不是本地下载复算或安装器文件哈希。

该记录只覆盖未签名 Windows 开发包及解包后的应用启动，不包含安装向导执行、签名发布或新增模型任务。服务器与已安装 Mac App 保持原冻结验收版本。两仓 PR 均 OPEN，未合并。过程恢复 HTML 是待确认设计；本轮没有新增恢复消费者。Frontend 后续源码修改须重新核对对应 head，不能沿用本次成功。
