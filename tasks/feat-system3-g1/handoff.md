# System3 G1 handoff

## TL;DR

- 用户已授权完整实现、真实测试与 litellm 服务器部署；统一正式 rc.2。
- 产品源码、Frontend、index、构建与部署由本会话独占。Jev 运维只在独立预检工作树审查。
- 入口/Skill/事实投影与双 SDK 回放通过；源码冻结和生产、桌面验收仍在进行。
- 主目录 main 未修改；此工作树保留。

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
| `docs/feat-system3-g1/` | 实施与部署文档、预检证据 |

## 设计约束

Jev 8086 是结构化决策协议，8002 不能替代；实际 profile 显式 high。只向获准 provider 发送获准数据。入口取消不得准入；模型建议、Host 采用、真实响应和产物验证是不同事实。Skill 使用原生 skill-invocation 消息并以精确 message id 确认注入，不引入新的 Session generation。用户固定模型优先，恢复自动通过原生 Session API。

## 已发现的真实行为

- TypeSafe SDK 默认重试/日志不适用于此路径，需显式关闭；凭据解析也计入总截止。
- 桌面自己的 runtime 必须覆盖 Cordis、API 和插件完整依赖，不能混用 npm stock runtime。
- electron-builder 的资源过滤可遗漏 node_modules；afterPack 显式复制并验证物理闭包、27 个补丁和模块导入。
- PPT 插件需要 preview-manifest 与模板资源；只验证包文件存在不足以保证启动。
- Linux 容器内 bubblewrap 受宿主限制；独立非 root systemd 保留原生 sandbox，未关闭沙箱绕过问题。
- 当前 Mac 本地包未签名/公证；开发验收不能表述为已完成签名分发。

## 下一里程碑任务清单

- [ ] 完成最终源码门禁并提交固定审查点。
- [ ] 部署该提交，真实完成 CSV 任务并以独立 oracle 核验产物。
- [ ] 验证取消、恢复自动、刷新和服务重启持久性。
- [ ] Desktop 正常/安全模式启动、干净提交装配与目录包验收。
- [ ] 双仓 ship、远端 SHA 核验、记录 CI 和回滚状态。

## 分支/部署状态

Harness 分支 `feat-system3-g1`；已接受基础标签 `system3-g1-foundation`。Frontend 分支 `feat-system3-integration`。服务器是预检版本，非最终产品；应用仅监听服务器 127.0.0.1:18731，通过 SSH tunnel 与原生 cookie 访问。私密启动 URL、凭据不进入文档。CI 尚未提交最终版本。

## 冷启动 checklist

1. 先读本文件、coordination-ack.md、implementation-ready.md 与 tasks/todo.md 当前实施段。
2. 检查双工作树状态、固定标签和 deployment-notes.md，保留所有未提交工作。
3. 检查服务器 current 与本地安装包 manifest，不能把预检当最终发布。
4. 只使用产品独立 BROWSE_STATE_FILE；不要干扰运维浏览器或 A100。
5. 按剩余验收清单继续，真实通过后更新本交接。
