# System3 G1 handoff

## TL;DR

- 用户已授权完整实现、真实测试与 litellm 服务器部署；统一正式 rc.2。
- 产品源码、Frontend、index、构建与部署由本会话独占。Jev 运维只在独立预检工作树审查。
- 入口/Skill、双 SDK、R1/R2/R3 固定复核及真实 Desktop/Linux 任务与恢复验收通过；双仓 PR 已创建。
- 用户追加手动部署授权；保留已验收产物，恢复本机 SSH 隧道并验证登录，Desktop 与默认浏览器已打开。
- 新增十二节统一架构与四图，核心为大小脑在 Harness 内融合及 AgentLoop × N；主目录 main 未修改，此工作树保留。

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
| `docs/feat-system3-g1/` | 实施与部署文档、最终证据；统一架构 HTML 512 行、英中来源清单及配对记录、浏览器证据和四组 SVG / 高清 PNG |
| `docs/feat-independent-harness/jev-native-dsh-native-plan.html` | 293 行；首图改为 AgentLoop × N，保留历史正文并指向统一页 |
| `docs/feat-system3-desktop/system3-native-v1.html` | 535 行；首图采用同一执行抽象，保留历史调用图 |
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
- [ ] 最新独立 Harness Actions 已实际执行；修复 persona expected 后等待新固定 HEAD 的远端回放，CI 通过前保持 PR 未合并。
- [ ] 按统一架构逐项接入约束 / 恢复、失败取证等过程消费者，真实采用与成果分别验收。

后续产品范围：本地 9B/27B Lead、Jev 记忆压缩和完整专家/长期 Goal 编排未在本轮验收；候选 Skill 目录超限时保留原生路径。

## 分支/部署状态

Harness 分支 `feat-system3-g1`；已接受基础标签 `system3-g1-foundation`。Frontend 分支 `feat-system3-integration`。服务器现运行已审查标签对应的稳定发布，真实重启和回滚通过；精确 release ID、源码提交、任务和恢复证据见 docs/feat-system3-g1/deployment-final.json。应用仅监听服务器 127.0.0.1:18731，通过 SSH tunnel 与原生 cookie 访问。本机已安装 ~/Applications/xDAN System3.app，使用 ~/.local/bin/xdan-system3 或 ~/Applications/启动 xDAN System3.command 启动；凭据只在包外的受限文件内。Desktop pin 与任务证据见 desktop-acceptance.json。私有 Harness PR #13、Frontend PR #1 已创建，均可无冲突合并但尚未合并。较早 Actions 因预算未执行；最新独立 Harness 工作流已执行，Host build 和行为测试通过，persona system prompt expected 错配导致回放失败。已最小修复 expected，三个本地 keyless 场景通过；修复提交的远端 CI 待核对。本地与真实运行证据不替代远端 CI。验收证据固定标签 system3-g1-acceptance-rc2，实际运行实现固定标签 system3-g1-reviewed-rc2。

## 冷启动 checklist

1. 先读本文件、[统一架构](../../docs/feat-system3-g1/architecture.html)、coordination-ack.md 与 tasks/todo.md；按当前事实和目标状态继续。
2. 检查双工作树状态、固定标签和 deployment-notes.md，保留所有未提交工作。
3. 检查服务器 current 与本地安装包 manifest，不能把预检当最终发布。
4. 只使用产品独立 BROWSE_STATE_FILE；不要干扰运维浏览器或 A100。
5. 按剩余验收清单继续，真实通过后更新本交接。

## PR 与 CI

[Harness PR #13](https://github.com/cryptoSUN2049/xDAN-System3-Harness/pull/13) 与 [Frontend PR #1](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/pull/1) 均已创建。较早远端 Actions 因预算未执行；后续 [独立 Harness 工作流](https://github.com/cryptoSUN2049/xDAN-System3-Harness/actions/runs/36803796698) 实际执行，build / 行为测试通过，persona expected 错配已按源码修复并本地回放通过。新固定 HEAD 的远端结果尚待核对，不把旧预算诊断继续作为当前失败原因，也不宣称 CI 已通过。冻结验收资料不依赖后续交接提交；独立审查已只读核对已安装 app 摘要、源码 pin 与稳定服务指针/单元配对。

## 本次手动访问交付

本机 SSH 隧道由独立运维会话恢复，产品会话继续维护访问；双方未重复发布或重启服务。默认浏览器已通过私有启动 URL 打开 Web，现有 Desktop 已置于前台。实际页面与资源归属见 [deployment-notes.md](deployment-notes.md#manual-access-verification--2026-10-01)，启动和断线恢复见 [部署参考](../../docs/feat-system3-g1/deployment.zh.md#访问和隔离)。本次没有新增模型或任务验收，不扩展原有冻结证据的范围。

## 统一架构交付

主入口 [architecture.html](../../docs/feat-system3-g1/architecture.html)，融合 12 份既有 HTML、9 个 Markdown 资料族及 3 份旧 SVG。AgentLoop × N、当前、目标、部署四图与六场景均内嵌，无 CDN，可离线阅读；源码链接和下载资源需保留目录。来源见 [architecture-sources.md](../../docs/feat-system3-g1/architecture-sources.zh.md)，验证见 [architecture-verification.json](../../docs/feat-system3-g1/architecture-verification.json)。本轮不调用真实模型、不重新部署、不修改已安装 App；运行 pin 仍以冻结验收为准。

MAAH 是后续控制策略研究命题，N=10 是协作设计示意。记忆、取证、完整专家 / Goal、本机 Lead 和总收益对照仍需各自实现与验收。构建 / 文档检查仅验证此次文档与快照修复，不扩展原发布验收范围。

本次文档验证：test:docs 20/20、doc-sync 42/42、lint（包含 Host build）、Ruff check / format、diff 检查均通过，keyless SDK 三场景通过。浏览器为独占 architecture state，不操作产品登录或审查会话。
