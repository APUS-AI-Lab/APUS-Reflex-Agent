# APUS Reflex 发布说明

[English](release-notes.md) | 中文

## 0.1.7-rc.2 · Reflex control 收口

本候选版本统一 DSH runtime 与 APUS Reflex 产品表面，仍属于开发预览，不替代上游 DSH 的许可证和 NOTICE。

### 新增与已验证

- Web 与 Electron 共用专用的**Reflex 模型配置**页面，provider、模型和 effort 设置会持久化并被真实请求使用。
- 可逆的按行/片段上下文投影与持久恢复，保留原始 Session 并保护 cache 前缀。
- 轻量 Codex Goal 监督，使用有界证据、带来源回正、原生消费和调整后验证。
- 严格受控真实 Codex 场景已完成财务产物、`verification-target`、独立 `1137.41` 校验和 `improved`，详见[语义 v6 证据](evidence/semantic-codex-strict-final-v6.zh.md)。
- APUS Reflex 品牌、MIT/NOTICE 保留、SECURITY 指南和 Electron 包审计。

### 公开发布前的已知限制

- 健康长任务误干预对照和用户中途修改 Goal 仍需真实远程 E2E 证据。
- 远端首字节/完整响应/回退测量仍待完成；当前 relay 探测在首字节前失败，见 [R-04 证据](evidence/r04-remote-response-20261012.zh.md)。
- Codex app-server 子线程活动尚未自动汇聚到父监督流。
- GitHub Actions 当前因仓库 Actions budget 无法启动检查。
- 本地目录包尚未签名或公证。

### 归属与许可证

APUS Reflex 采用 MIT 分发，同时保留上游 DSH 版权和许可声明。第三方许可证见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。运行模型生成工具前请阅读 [SECURITY.md](../../SECURITY.md)。
