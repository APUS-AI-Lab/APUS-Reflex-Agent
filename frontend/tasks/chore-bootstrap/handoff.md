# xDAN System3 Frontend 初始交接

## TL;DR

- 独立私有仓库：cryptoSUN2049/xDAN-System3-Frontend。
- 来源：dataelement/dsh-desktop，保留 main 的完整 481 条提交历史及 MIT / DataElement 版权。
- origin 指向私有仓库，upstream 指向原项目；本地使用按需下载 blob 的 partial clone。
- 应用品牌、runtime 接入与 System3 UI 尚未修改或运行验证。

## 本轮交付物

- `.github/scripts/feishu_release_notes.py`、`.github/scripts/github_release_notes.py`：通过 Ruff 格式门禁的纯格式修改，AST 保持一致。
- `docs/chore-bootstrap/repository.md`：仓库来源与职责。
- `tasks/chore-bootstrap/handoff.md`：当前交接。

## 设计约束

保留 upstream 许可证与版权。桌面壳包装唯一 Harness runtime / Conversation；智能策略与持久状态属于 xDAN-System3-Harness。产品代码变更在隔离 worktree 中完成。

## 已发现的真实行为

完整传输曾发生 early EOF 与 TLS 连接失败；partial clone 成功。上游 package.json 使用 DSH 0.1.7-rc.2，README 仍包含 rc.1 描述。Ruff lint 通过，格式检查最初有两个文件失败；格式化后两项通过，Python AST 对比一致。

## 下一里程碑

- [ ] 完成入口智能、过程智能、体感智能的统一设计与确认。
- [ ] 固定自有 Harness runtime 接入方案，验证版本与原生插件兼容。
- [ ] 在新的 feature worktree 中实施品牌与 UI，保留实际来源及状态语义。
- [ ] 运行真实桌面、权限、取消、专家回传和恢复验收。

## 分支与部署

本地 main 保留上游基线；chore-bootstrap 承载纯格式与来源文档，首推到私有仓库 main。未发布安装包，未声明 CI 或桌面启动通过。

## 冷启动 checklist

1. 先读本文件和根 AGENTS.md，再读 docs/architecture.md。
2. 检查分支、worktree、状态与 origin / upstream。
3. 三层智能设计位于相邻 xDAN-System3-Harness 仓库的 feat-system3-desktop worktree，docs/feat-system3-desktop/ 下。
4. 产品代码实施前确认具体设计，并使用隔离 worktree。
