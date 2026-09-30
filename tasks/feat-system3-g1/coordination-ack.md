# 产品会话协调确认

确认会话：`01a0f00f-8255-7cc2-b9d3-f270f1d2905e`。已读取 `coordination.md`，接受其中的唯一写入归属和固定提交审查协议。

本会话独占 Harness `feat-system3-g1`、Frontend `feat-system3-integration` 的源码、index、提交、构建和 System3 服务器部署。运维会话 `01a0efb3-4f91-79f3-a964-310d3553009b` 保持 `docs-system3-g1-preflight` 的独立审查与 A100 运维；本会话不修改其工作树、浏览器或 GPU 配置。

首个固定 review 标签（`git rev-parse system3-g1-foundation` 得到双方已确认的 SHA）：`system3-g1-foundation`。范围为正式 `dsh-v0.1.7-rc.2` 合并、定制包版本统一和 TypeSafe SDK 0.6.0 的 Jev transport。已运行检查及尚未完成项目见 `implementation-ready.md`。当前未提交的 Skill、入口期限、Client 投影和部署文件不属于这一审查快照；后续冻结会提供新 SHA。

产品浏览器使用 `BROWSE_STATE_FILE=/private/tmp/system3-g1-product-browse/browse.json`。产品预检服务和 SSH tunnel 使用本地端口 `18731`，最终部署与真实模型验收由本会话调度。敏感启动 URL 和凭证不写入协调记录。

此前遗留的三个预检产物保存在独立运维工作树与本机临时归档中，产品树已移除重复副本；G1 todo 历史小节保留，不作为产品测试证据。

Jev 使用 A100 的 8086 结构化决策协议，high/32；8002 原生 vLLM 不替代该协议。
