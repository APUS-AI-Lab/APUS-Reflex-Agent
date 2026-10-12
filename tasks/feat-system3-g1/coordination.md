# System3 双会话协调记录

记录会话：01a0efb3-4f91-79f3-a964-310d3553009b。用户已明确要求两会话协调。

## 状态

本会话已识别另一产品会话 01a0f00f-8255-7cc2-b9d3-f270f1d2905e，并撤出正在合并的工作树。跨会话 MCP list/send 消息接口返回 HTTP 502；随后通过原生 multi_agent send_input 非中断排队成功，submission_id 为 01a0f39d-9d71-7841-82b9-084f08d33c67。下表是本会话执行的职责分配，尚未收到对方确认；排队受理不代表对方已确认。

## 唯一写入负责人

| 会话 | 工作树或资源 | 职责 |
| --- | --- | --- |
| 产品实现：01a0f00f-8255-7cc2-b9d3-f270f1d2905e | Harness feat-system3-g1；Frontend feat-system3-integration；System3 验收服务器 | rc.2 合并、冲突修复、产品配置、构建/测试、桌面接入与部署，拥有这些工作树的 index/commit |
| 本会话：01a0efb3-4f91-79f3-a964-310d3553009b | Harness docs-system3-g1-preflight；ops-jev9b-a100 与 Jev A100 Pod | 独立兼容审查、固定快照验证建议、Jev API 运维交接；不修改产品源码、index 或部署 |

两个仓库的 main 主目录保持不动。本会话不会在实现工作树 merge/reset/stash/add/commit、安装依赖或运行构建，也不修改另一会话的服务器。共享协调文件是唯一有意写入该工作树的例外。

## 交接协议

1. 产品会话完成可审查批次后，在 implementation-ready.md 写固定 commit SHA、修改范围、已运行命令/结果、仍未验证项；不要以正在变动的工作树作为稳定交付。
2. 本会话只基于该 SHA 或完整 diff 快照审查，把发现写到独立审查工作树的 review-findings.md；每条包含文件/行、触发条件、影响和建议检查。不开第二个实现分支修同一问题。
3. 产品会话统一修复、重跑受影响检查，并给出新 SHA；合并/提交/推送权归写入负责人。性能测试与实际部署由一个会话运行。
4. gstack 浏览器按会话设置独立 BROWSE_STATE_FILE，例如 /private/tmp/system3-g1-review-browse/browse.json。不要 restart/stop 对方 daemon。产品 E2E、共享开发 Profile 与安装包验收由产品会话独占；本会话使用私有临时 Profile。
5. 不能 kill 对方 PID、抢占端口或 GPU，不能互相覆盖 root todo、锁文件或 generated 目录。需要接管先写明确移交记录并由对方确认。

## 实现会话需知

本会话最初开始独立预检时，尚未发现另一个执行过程也选择了 feat-system3-g1。留在该树的 g1-execution-design.html、merge-preflight.json、desktop-patch-inventory.json 和追加的 G1 todo 小节来自本会话；现已复制到 docs-system3-g1-preflight。本会话没有删除、撤销或继续修改这些文件，避免覆盖你已经采用的材料。请由产品写入负责人决定保留或移除，勿将这些预检记录当作产品测试证据。

当前 A100 Jev 入口：https://jev.example.invalid；model APUS-OpenJev-v1-9B-5949；默认 high/32 层。27 项结构化 API、15 项原生 vLLM、5 个指南示例已通过。原生 8002 不替代 System3 决策协议。Key 沿用现有受控引用，不贴入协调文件或消息。

## 对方确认

尚无确认。产品会话可在独立 coordination-ack.md 记录会话 ID、认领工作树、当前阶段、下一固定 review SHA 和资源预约；避免两会话改同一文件。
