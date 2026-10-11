# Continuum × Reflex Control 集成计划

[English](integration-plan.md) | 中文

## 目标

将 `feat-continuum-memory` 的 Session-backed 连续记忆与 `feat-reflex-control` 的控制面、目标路由、上下文投影和监督能力组合到一个可回归的 dev 分支。

## 合并顺序

1. 以 `feat-reflex-control` 为基线创建本分支。
2. 使用 `git merge --no-ff feat-continuum-memory` 保留可审计的集成节点。
3. 优先人工解决运行时配置、Session event types 和事件持久化目录。
4. 重新生成或校验 lockfile、persistence catalog、snapshot 和文档索引。
5. 先跑包级单元测试，再跑控制面与 Continuum 的交叉测试，最后跑真实模型和浏览器链路。

## 已知重叠面

- `deploy/system3/runtime.patch.yml`：必须同时保留控制面插件、Continuum/Jev selector、默认关闭和配置注入顺序。
- `packages/core/session/src/known-event-types.ts`：合并两侧事件声明，确认所有模型可见事件可重放。
- persistence catalog/schema：只追加当前生成事实，不覆盖已发布历史格式。
- `pnpm-lock.yaml`、`tsconfig.base.json`、快照 fixture：以合并后实际依赖和输出重新验证。

## 场景验收矩阵

| 场景 | 通过标准 |
| --- | --- |
| 默认原版 profile | 不加载 Continuum 时控制面行为与基线一致 |
| 开关生命周期 | off/shadow/active、reload、关闭后投影清理一致 |
| 跨重启续做 | Session、record ID、sourceRefs 和控制面状态可恢复 |
| 纠正与冲突 | supersede 后旧事实不再作为当前事实，revision 冲突无部分提交 |
| 权限与范围 | 未授权/private scope 不进入工作集或模型请求 |
| 预算与长历史 | 检索、摘要和模型请求不突破预算；1,000+ 记录可重建 |
| 停用竞态 | 在途读取和迟到 Jev 结果不能注入 |
| Jev 故障 | timeout、cancel、abstain、fallback 可回放且可恢复 |
| 索引故障 | 索引落后或重建时仍以 Session 为准 |
| 并发持久化 | 重复 flush 不重复写入，失败重试不丢记录 |
| 控制面联动 | goal/context/supervision/runtime projection 不相互覆盖 |
| SDK 回放 | TypeScript/Python 可还原同一模型可见结果 |
| 真实链路 | RunPod Jev、DeepSeek、浏览器 E2E 通过 |

## 退出条件

只有在冲突已解释、上述场景均有测试证据、控制面原有回归无新增失败，并且已知基线失败被单独记录后，才可创建面向主力分支的 PR。该条件不等于宣称“无限存储”或“所有任务质量已证明”。
