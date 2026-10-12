# sharp 安全锁文件更新

日期：2026-10-12。

官方公告：[GHSA-wq5f-xc86-pv6w](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)。GitHub Advisory API 声明受影响范围为 `< 0.35.5`，首个修复版本为 `0.35.5`；维护者说明该版本的预编译库提供 librsvg `2.63.2`。公告所述潜在 RCE 涉及特定 glibc Linux 运行条件，不能据此认定 macOS 具有相同利用条件。

已通过 npm registry 核实 `sharp@0.35.5` 元数据和发布完整性摘要。保持全部 package.json 依赖范围不变：现有 `^0.35.3`、`^0.35.4` 均接受修复版本。

- 根 `pnpm-lock.yaml`：sharp `0.35.3` → `0.35.5`，对应 `@img/sharp-*` 原生包同步更新，libvips 载体 `1.3.2` → `1.3.4`。
- `frontend/package-lock.json`：sharp `0.35.4` → `0.35.5`，对应原生包同步更新，libvips 载体 `1.3.3` → `1.3.4`。
- 仅采用包管理器生成的 sharp 相关锁记录；移除了解析过程产生的无关依赖变化与格式变化。

验证：锁文件可以解析；sharp 快照引用均存在；逐项比较确认两套锁无无关依赖变化；`git diff --check` 通过。按主代理要求未执行构建或测试。更新使用 lock-only 与 ignore-scripts，没有更新共享 node_modules；现有 frontend 安装仍为 `0.35.4`，后续安装/打包必须先按新锁恢复依赖。

发布验收仍需在最终部署目录读取实际 sharp 版本与 `sharp.versions.rsvg`。动态生成的部署依赖树不能只用开发锁摘要代替。建议部署 inventory 包含每个物理 package.json 的相对路径、包名、版本、许可证字段、manifest SHA-256，按路径排序；同时保存部署锁摘要和 sharp 原生库版本。在运行目录最终修改结束后生成，打包后复核摘要，并将 inventory 摘要写入 build-info。
