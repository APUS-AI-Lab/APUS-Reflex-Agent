# 开源文档审计

[English](open-source-docs-audit.md) | 中文

这份审计面向 Harness 与独立 Frontend 仓库的公开发布，按发布动作分类，不会自动删除内部复现材料，因为其中一部分仍服务于内部验收。

## 公开仓库前必须阻断

- 删除或改写绝对本地路径以及 `.Codex`/`.claude` worktree 路径。当前例子包括 `docs/feat-jev-decision-kernel/completion-browser-result.json`、`docs/feat-jev-decision-kernel/completion-browser-session.jsonl`、`docs/feat-system3-foundation/evidence.json`、`docs/feat-system3-foundation/design.md`、`docs/feat-system3-desktop/delivery-objectives-and-ux-audit.html` 和若干 `tasks/*/handoff.md`。
- 删除公开说明和证据中的私有基础设施 endpoint，或改成 `<JEV_ENDPOINT>` 并提供由负责人维护的可复现实验 fixture。当前例子包括 `docs/feat-continuum-memory/continuum-evaluation-results.json`、`docs/feat-reflex-control/cache-benchmark-design.md`、`docs/feat-reflex-control/evidence/entry-routing-eval-v2.json` 和 `native-recovery-real-v*.log`。
- 把 `docs/feat-reflex-control/apus-reflex-harness-acceptance-review.html` 中指向本地 Frontend worktree 和 feature branch 的链接改为合并后的 `main` 或版本化发布产物。
- 在数据负责人审阅前，不要公开 provider request log、Session JSONL、原始浏览器捕获和截图。默认把 `docs/feat-jev-decision-kernel/completion-browser-session.jsonl`、`docs/feat-reflex-control/evidence/*.json`、`*.log` 以及用户界面 PNG 视为内部材料。
- Actions 预算恢复后完成真实 Gitleaks 扫描。当前会话中的本地扫描仍在执行；在成功退出前不能宣称秘密扫描通过。

## 审阅脱敏后保留

- 架构、API 契约、README 示例、确定性的 keyless fixture，以及不含私有 endpoint、用户内容、本地路径和凭据的精简证据。
- Loop Working 架构图和经典案例集，但要先把内部链接替换成仓库相对链接或公开发布产物链接。
- 验收摘要：保留测试命令、日期、模式和限制，不嵌入原始 provider 流量。

## 不要作为产品证明公开

- 内部 handoff、放弃的设计探索、私有组织/仓库历史、原始模型 transcript、不完整性能运行，以及把 skipped workflow 写成 passed 的文档。应移入私有证据归档，或改写为简短的当前发布说明。
- 任何把 RunPod URL、gateway URL、机器路径、仅分支链接或 commit pin 写成长期公开依赖的文档。

## 发布前必做检查

1. 使用仓库配置对 tracked checkout 和历史运行 Gitleaks。
2. 运行 `pnpm run verify-public-repository-links`、`pnpm run verify-repository-references`、`pnpm run test:docs` 和 `pnpm run doc-sync`。
3. 逐一检查 `docs/` 与 `tasks/` 下的 HTML/JSON/JSONL/log/image 是否命中上面的阻断清单。
4. 从两个独立仓库的干净 `main` checkout 重建，并确认 README 命令使用公开路径和占位凭据。
