# System3 Desktop 接入交接

## TL;DR

Frontend 已验收产品保持不变，分支 `feat-system3-integration`；本轮收口 Windows PR CI，安装包与服务器不重部署。
自有 rc.2 生产依赖闭包、27 项 Desktop 兼容补丁、最终 Resources 校验和原生 normal/safe 启动已完成。
Harness reviewed tag `system3-g1-reviewed-rc2` 已修复 request-failure 归因和历史 UI 状态；新的 clean 包通过最终 Resources、normal/safe 启动与历史恢复验收。此前包仅为历史预验收。
真实公开 CSV 任务已通过外部 oracle；停止/恢复、固定模型→自动模式及重启回放通过。已安装桌面的真实自动 Skill 注入与产物验收通过；Linux 同源码发布、重启和兼容回滚后的同会话回放也全部通过。

## 本轮交付物

下表为主要交付文件当前总行数。产品壳的 splash、web-import、safe-mode、plugin-recovery HTML 与对应 view/version/menu 文案已替换产品名；主画面 Harness logo 仍保留上游样式。

| 文件 | 行数 |
| --- | --- |
| `src/main/system3-runtime.ts` | 68 |
| `src/main/system3-identity.ts` | 9 |
| `src/main/index.ts` | 3615 |
| `scripts/prepare-system3-runtime.mjs` | 139 |
| `scripts/generate-system3-patch.mjs` | 25 |
| `scripts/patch-system3-runtime.mjs` | 99 |
| `scripts/verify-system3-runtime.cjs` | 25 |
| `scripts/package-system3-runtime.cjs` | 59 |
| `package.json` | 487 |
| `electron-builder.dev.cjs` | 22 |
| `src/main/desktop-service/index.ts` | 46 |
| `src/main/update/update-manager.ts` | 339 |
| `test/system3-runtime.test.ts` | 77 |
| `test/system3-identity.test.ts` | 16 |
| `test/release.test.ts` | 587 |
| `test/ppt-source-build-contract.test.ts` | 59 |
| `docs/feat-system3-integration/runtime-integration.html` | 3 |
| `docs/feat-system3-integration/desktop-packaging.md` | 39 |
| `docs/feat-system3-integration/packaging-preflight.json` | 116 |

`prepare-system3-runtime.mjs` 生成 pinned manifest 和物理生产依赖树；`patch-system3-runtime.mjs` 只适配产物，不覆盖 Harness 源码。`package-system3-runtime.cjs` 在 afterPack 完整复制闭包并验证最终安装目录。`index.ts` 由 root 负责 profile、共享 runtime、品牌及安全模式接线。

## 设计约束

- 所有 Agent 执行与会话持久化使用同一个自有 Harness；只通过 `dsh` profile 启动。
- 安装包必须使用 deployed manifest，锁定 40 位 sourceRevision、平台和架构；禁止 stock fallback。
- 7 个自有包包含 CLI 与 6 个 experimental 包（含客户端 System3 UI），版本统一 `0.1.7-rc.2`。
- 生产 prepare 要求 clean source；本地 dirty 预验收必须显式 opt-in，并记录到 manifest。
- 保留 MIT 版权与上游包协议名称；禁用 fork 上游诊断提交和自动更新，保留本地日志。
- 默认数据分类为 workspace；public 只用于明确声明的验收夹具。不要把个人文件放入 public 工作区。
- 凭据不得进入源码、包资源、截图或日志证据；由私有启动入口注入选定环境变量。

## 已踩坑与真实行为

1. pnpm v11 legacy deploy 会改变源树安装状态。只在独立临时源码树运行；准备前后原 Harness `.modules.yaml` hash 不变。
2. electron-builder 的 extraResources 会过滤 node_modules。仅 build exit 0 不代表包完整；afterPack 必须显式复制并检查最终 Resources、补丁 hash、实际 dsh 版本和模块导入。
3. PPT 的 preview-manifest/templates 来自 generated runtime；复制原始 PPT package 会缺少文件，导致 native required plugin 加载失败。
4. Desktop 会将相对 profile 插件路径重定位到用户 DSH_HOME。自有插件必须用 bare package name，并写入生成产物 CLI resolver manifest，不能污染源 CLI 的默认依赖。
5. 27 个补丁的 JS 均实际应用并 node --check；own TS 声明保留。CSS hash 按同一模块导出键映射；3 处 generated context 适配保留 System3/reset API。
6. 上游 diagnostics 可能在 bootstrap 前显示 NSAlert，表现为进程在、无页面、无新 Harness 日志。已禁用独立产品的上游服务；使用 `/usr/bin/sample` 可定位，PATH 中另一 sample 命令不可用。
7. 独立 userData 不会自动改变默认工作区目录。默认 workspace 仍可能指向用户 Documents；验收必须显式创建独立公共目录，不能写用户默认目录。
8. normal 与 safe 两个实例的移动桥固定占用 43127，双实例会碰撞并弹窗。验收按顺序运行；safe 实际使用 own `desktop-safe-mode` profile，reviewed包 ready1234ms。
9. 本机 Python 的 site 初始化在真实 shell 中阻塞；Node.js/Perl 可工作。公开 CSV 任务取消后用 Node 恢复，外部 oracle 确认金额与订单数。
10. 用户 `~/.agents` 技能会进入原生 catalog，即使 maxCandidates32 仍可能超限。QA 启动器使用明确隔离的 `DSH_AGENTS_HOME`，不删除用户技能、不修改产品全局范围。

## 下一里程碑任务清单

- [x] Frontend 全量 173 文件 / 1554 测试、typecheck 与 Ruff 通过。
- [x] 自有闭包、最终安装目录校验、历史 clean 包 normal/safe 启动。
- [x] 真实公开 CSV 外部 oracle、停止/恢复、固定→自动和重启回放。
- [x] 以 reviewed tag 重新 clean prepare、build:dir，normal1435ms/safe1234ms就绪。
- [x] reviewed 桌面真实自动 Skill 选择→注入→下一次 Fidoo 请求采用→产物验收，使用隔离公开目录；Jev entry1403ms/Skill311ms，外部oracle2checks通过。
- [x] Linux 同源码 stable→verify 发布、真实任务、restart、rollback stable及同会话浏览器回放；产物hash不变、重复rollback拒绝且无重启。
- [x] 最终证据和双仓 PR 已提交；新 Windows CI 修复等待固定 head 的原生验证。
- [ ] 主画面产品品牌通过原生 branding 配置完善；签名/公证与独立更新服务不属于已验证交付。

## 分支与部署状态

Frontend worktree：`/Users/gumpm5/Documents/Code/xDAN-System3-Frontend/.Codex/worktrees/feat-system3-integration`。产品代码已提交；最终证据与本 handoff 待 root 后续提交。reviewed 包已实际安装到 `~/Applications/xDAN System3.app`，由 `~/.local/bin/xdan-system3` 或 `~/Applications/启动 xDAN System3.command` 启动。凭据在 `~/.config/xdan-system3/runtime.env`（0600），不在 app 资源。root 验证安装位置启动 ready1951ms，原会话与 CSV 结果恢复；证据见 Harness desktop-acceptance.json 的 installation。Desktop 进程现由 root 管理，旧 QA PID 不再作为当前依据。

Harness worktree：`/Users/gumpm5/Documents/Code/xDAN-System3-Harness/.Codex/worktrees/feat-system3-g1`。服务器 `/opt/xdan-system3/current` 保留已验收的 stable release，loopback18731+原生鉴权保持启用。精确release ID见Harness deployment-final.json。旧预审控制器已终止且从未激活。两次同源码发布、真实任务、restart和rollback均已完成，previous已消费，第二次rollback会明确拒绝。配对unit及指针修复通过8个独立容器fixture及真实回滚。

## 冷启动 checklist

1. 先读本文件、`docs/feat-system3-integration/desktop-packaging.md` 与 packaging-preflight.json，再读 Harness handoff/deployment 文档。
2. 两个 worktree 都执行 status、HEAD 检查；与 root 确认最新冻结 SHA 和文件所有权，不复制半完成 lib。
3. 确认没有准备脚本或发布脚本在运行，确认旧预审 controller 已不存在。
4. `node scripts/prepare-system3-runtime.mjs --deploy --source <Harness-worktree>`；确认 sourceDirty=false、实际 sourceRevision 匹配。
5. 先关闭精确识别的旧 native PID，再 `npm run build:dir`。仅测试更新包后声明安装产物通过。
6. 用私有启动器注入凭据与隔离 profile。native CDP 可以只检查界面；只有明确授权的验收步骤才调用模型。
7. web 验收用 gstack browse；源码修复由对应 owner 完成。证据不能包含 token、key、cookie 或个人工作区内容。

## 最终 ship 状态

私有 Frontend PR #1 与 Harness PR #13 已创建；相关源码、验收资料均已推送。GitHub Actions 账户预算阻止 job 启动，无测试步骤执行，PR 保持未合并。运行实现和已安装目录包不受交接文档提交影响。独立审查只读核对实际 app.asar 摘要、runtime pin 与服务器稳定发布；回滚验收仅覆盖同源码两个 release，不证明旧 Session 读取兼容。

## Windows CI 修复进展

Harness PR #13 的产品架构固定提交已通过 Independent harness CI。Frontend PR #1 旧 run 36777222196 第二次执行已不受预算阻止，Windows npm ci/build 成功，测试 1548 通过、2 失败、4 跳过。失败为六语 README 上游下载断言过时与 identity fixture 写死 POSIX 路径；现已修复。

工作流还缺自有 Harness 闭包准备，且 Windows smoke/产物名仍为上游名称。本轮固定 reviewed Harness revision，以本平台构建→prepare→own Electron wrapper probe→unsigned package→isolated packaged smoke 连接验证链。只读 Deploy Key ID 165054778 对 Harness 生效，私钥仅在 Frontend Actions secret `SYSTEM3_HARNESS_READ_KEY`，生成临时文件已删除；未复制开发 PAT、Jev 或 Fidoo 密钥。checkout 不保留凭据。

本地已完成两组33测试、全量173文件/1559测试、typecheck、actionlint与Ruff；构建通过，自有闭包经 Electron wrapper 启动并通过认证 HTTP 200（macOS arm64，无模型调用）。Windows结果只能由新固定head实际CI证明，不以macOS本地通过代替。

补充静态待核验：`build/windows-hidden-console.mjs` 的 packaged koffi anchor 使用 resources/app，而 ASAR 开启时 shell 依赖在 app.asar.unpacked，可能导致隐藏console退化；当前不影响主启动，尚未进行Windows复现，本轮未扩大修改此路径。

本轮修改范围：release.yml（1163行）补 Windows 自有闭包链；prepare-system3-runtime.mjs（139行）改 Node 启动 pnpm；patch-system3-runtime.mjs（99行）使用工作目录内 patch 输入；probe-electron-node-runtime.mjs（123行）增加 own manifest/entry 模式；release/identity 两组测试更新；.gitattributes 固定补丁LF；ci-recovery-plan.md、desktop-packaging.md、todo、lessons与本交接记录当前限制。

## Windows 原生 CI 第二次修复

run 36865555120 已实际通过 Frontend tests/types、私有 pinned checkout、Harness完整Windows构建及依赖装配，随后conversation补丁2/16 hunk因Windows CSS region路径漏配而拒绝。只修adaptCss匹配路径分隔符并保留own原注释，新增歧义拒绝，不改变CSS声明或fuzz=0。真实产物本地复现与修复正反例、27补丁/37JS目标模拟Windows路径、174文件/1565测试通过；新固定head原生CI待执行。新文件test/system3-patch-context.test.mjs保存6项回归。

## GNU / BSD patch 差异修复

run 36868256274 已通过全部CSS补丁，失败在undici最后hunk。已用本地GNU实际复现，根因是前3后2不平衡上下文触发GNU的EOF约束，并非已证依赖漂移；未改依赖版本。undici补丁增加原有上下文至4/4，保留全部业务修改和fuzz=0；GNU/BSD均通过27补丁/37目标。新增test/system3-runtime-patch.test.mjs真实逆向/重放锁定npm输入并验证业务上下文变化拒绝；CI提前提供GNU patch。新head原生结果继续独立核对。

## Windows 工具选择修复

run 36871021141：两项新增GNU补丁回归通过，1562测试通过/1失败/4跳过。原build-approval测试因Git usr/bin前置PATH抢占Windows tar，GNU tar把C:当远端而失败。现只通过SYSTEM3_PATCH_COMMAND指定patch.exe绝对路径，保留原PATH；测试子进程增加30秒上限。下一固定head继续完整验证，不跳过该原有集成测试。
