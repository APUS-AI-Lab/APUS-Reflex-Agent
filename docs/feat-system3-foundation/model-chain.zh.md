---
description: "System3 的生成服务与可选 Reflex 服务配置。"
---

# System3 模型调用链

[English](model-chain.md) | 中文

## 当前配置

请使用 [公共模型服务配置](../dev-continuum-reflex-integration/public-provider-configuration.zh.md) 设置官方生成服务、可选 Reflex、自有 relay、凭据与 Codex 委派。生成与决策推理使用独立 provider 和显式数据共享策略。生成响应本身不能证明调用了 Reflex。

## 历史源码示例

`system3-fidoo-runpod-*.patch.yml` 保留早期源码部署示例和历史 provider ID，不是公开默认配置。relay 需要显式设置 `SYSTEM3_GENERATION_BASE_URL`、用户管理的凭据和实际注册的模型 ID。tunnel 示例要求受控的 loopback 转发；即使客户端 URL 是 localhost，转发到远端仍属于网络执行。same-host 覆盖仅适用于 Jev 确实在 Harness 宿主运行的情况。这些配置都不负责限制生成服务的网络出口。

不分发依赖特定运维环境的历史 SSH 凭据启动脚本。当前 profile 准备不需要 SSH 或远程抓取凭据；请提供自己的服务地址和凭据引用。

## 验收

[System3 服务](../../packages/experimental/system3/README.zh.md) 将已发送请求和验证后的结果记录为类型化决策。应分别验证生成输出、通过授权的决策 receipt、重放和禁止数据的处理。历史连通性结果不能证明新部署或决策质量 benchmark 已通过。每个部署都应运行对应的本地配置测试及显式配置后的真实 provider 测试。
