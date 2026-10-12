# Frontend branding progress

- Canonical display and resource integration implemented; no commit or push yet.
- npm ci: passed, 27 compatibility patches replayed.
- npm run typecheck: passed.
- npm run build: passed after importing canonical Harness brand assets.
- npm test: 172 files / 1556 tests passed initially, 5 files / 13 tests failed; all five failed files subsequently passed (46 tests) after fixes.
- First full test overlapped a second PPT generation started by build; this caused one transient missing metadata file. Build/generation/test consumers must run sequentially. No production PPT changes required.
- Final sequential full vitest: 177 files / 1569 tests passed. Release/sign filename follow-up: 33 tests passed.
- Remaining: reviewed Harness SHA pin, deployed runtime prepare, actual package and normal/safe startup checks, final diff check and commit coordination.

- Native Electron recovery UI smoke: 120 variants passed (scale 1 / 1.25 / 1.5, 40 each); isolated smoke profiles and screenshots in artifacts/recovery-ui. Includes light/dark, en/zh, 900/1280 widths and interaction checks. Follow-up labels identify the linked DSH community as upstream.

- 最终 Harness build 后首次装配发现 settings-models 3 hunks 上下文变更（2 welcomeBody 品牌、1 welcomeNotice 配置）；保持 fuzz=0 并仅对该目标精确适配，新回归覆盖失败拒绝。
- 产品 runtime.patch 增加 subagent 组后，原生成器仅能解析 experimental，已改成读取规则包路径下 package.json 的实际包名；deployed/workspace 两模式测试通过，未放宽未解析路径拒绝。
- 2026-10-10 本地 dirty runtime deploy 成功；Electron RunAsNode probe darwin/arm64 HTTP200 通过。发布前还需最终 clean SHA/pin。

- MIT追加验收发现Electron builder不会自动把electron/dist/LICENSE与LICENSES.chromium.html纳入当前.app；已显式复制到Resources/licenses。六份原文在afterPack逐字节验证；移除LICENSE*.md排除规则保留依赖各自许可。
- 真机dev进程87656正常启动、97049重启读取、98306安全模式启动均完成并已关闭；没有动既有体验分支应用。gstack使用独立状态目录/private/tmp/apus-frontend-browser与原生进程实际URL。截图在artifacts/brand/，明暗1280x850及窄屏390x844，后者scrollWidth=390。重启恢复验证UI创建的空白session，不调用模型；Profile里的另一个hihihi会话未由agent发送。恢复后同一session ID可读；压缩日志可在关闭时重新写入，不能以压缩字节一致作为恢复证据。
- GitHub release/backfill存量上游ModelScope与飞书步骤现以vars.APUS_RELEASE_AUTOMATION == 'true'门禁。默认缺省/false均关闭发布、签名和归档；PR与workflow_dispatch development保留。主分支push不触发当前release工作流。

- 最终clean prepare首次因CLI lib/bin.js在复制树中缺失失败；与Harness push hook会重build host并发。先等push hook彻底结束，再冻结源执行prepare，完成后才做剩余文档/推送；不添加缺文件回退。
- 新增Frontend checks只读CI：main push/PR，Node24 Ubuntu，npm ci → typecheck → npm test（pretest生成PPT）。源码测试不要求另取Harness部署闭包，CI不签名不发布不使用外部消息凭证。
