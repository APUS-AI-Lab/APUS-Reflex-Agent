# macOS 签名遍历补丁

[English](macos-signing-walk.md) | 中文

本补丁针对 `@electron/osx-sign` 1.3.3，仅修改其 CJS 与 ESM 产物中的 `walkAsync`，将递归无界 `Promise.all` 遍历改为顺序遍历。二进制候选、嵌套应用及 framework 顺序、`.cstemp` 清理和文件系统错误保持原有行为。签名、权限配置和资源封印校验继续启用，不排除任何包文件的检查。

发布运行 38418508324 的 Full 与 Lite arm64 任务已将实际软文件上限提高到 32768，仍在扫描签名资源时触发 `EMFILE`。签名忽略配置不能解决这一阶段的问题，因为依赖先遍历目录，再过滤签名候选。顺序遍历限制同时进行的探测，无需新增信号量、调参常量或依赖；代价是降低扫描并发。

## 归属与移除条件

可重放变更位于[版本化补丁](../../frontend/patches/@electron+osx-sign+1.3.3.patch)，行为测试位于 [macos-signing-walk.test.mjs](../../frontend/test/macos-signing-walk.test.mjs)，真实签名覆盖沿用 [macos-signature.test.mjs](../../frontend/test/macos-signature.test.mjs)。上游升级版本提供有界遍历，并通过相同的候选顺序、清理、错误、低文件上限和资源篡改检查后，才能移除此补丁。单纯提高 shell 上限或成功生成压缩包均不满足移除条件。

## 本地验证

全新临时目录复制了未修改的 frontend 包清单、锁文件、`.npmrc`、本地包源码与完整补丁集合。`npm ci --no-audit --no-fund` 在 16 秒内安装 990 个包，其正常 postinstall 成功应用新补丁。运行中预览的依赖和构建产物未被修改。首次复制不完整，缺少 `.npmrc`，在安装前的 peer-dependency 锁验证失败；补齐仓库配置后，同一未修改锁文件通过。

| 检查 | 实际结果 |
|---|---|
| 未补丁负对照，软上限 128，30 个目录内共 1200 个二进制文件 | 子进程按预期因 `EMFILE` 失败 |
| 补丁后 CJS 与 ESM 的候选顺序、临时文件清理、幂等性和错误传播 | 四项测试通过 |
| 补丁后 CJS，相同低上限与大目录 | 返回全部 1200 个二进制候选，一项测试通过 |
| 既有 macOS 原生签名、权限配置、内置 Node 执行及资源篡改 | 两项测试通过；签名应用校验成功，资源被修改后校验拒绝 |

五项遍历测试耗时 447 ms，两项签名测试耗时 3.32 秒。这些是 fixture（测试前置数据）的运行耗时，不是完整产品打包基准。ESM 产物通过既有 Vitest loader 执行，低文件上限子进程调用真实 CJS 模块。保留了上游 source map 缺少源码文件的警告。验证机器上的日志为 `/tmp/apus-osx-sign-negative.log`、`/tmp/apus-osx-sign-clean-ci.log`、`/tmp/apus-osx-sign-patched-tests.log` 和 `/tmp/apus-osx-sign-seal-test.log`。这些检查没有重新构建或发布安装包；各平台 Full/Lite 的真实打包和安装仍须验证。
