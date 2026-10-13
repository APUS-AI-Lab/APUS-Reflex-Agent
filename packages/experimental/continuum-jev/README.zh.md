---
description: "APUS Continuum 有限记忆选择的实验性 Reflex/Jev 控制器。"
kind: package-reference
---

# @deepseek-ai/dsh-experimental-continuum-jev

[English](README.md) | 中文

## 概述

本包为 APUS Continuum 候选排序，不从已预算的本地 baseline 删除任何记忆。一次 Jev 请求判断最多十六个独立相关性命题。active 应用排序，shadow 记录建议，off 不发请求。profile 发送前必须完成出站许可、完整请求预算检查及 prepared receipt 持久化；provider 失败保留全部 baseline。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在有限本地检索后加载默认 `ContinuumJevPlugin` profile service。配置 `mode`、`timeoutMs`（默认 2000）、`maxRequestBytes`（默认 32768）、`privacyPolicy`（默认 `{ mode: local-only }`）及 `sessionDataClasses`（默认 null，拒绝出站）。所有 Jev 路由均保守归为 network。授权时使用 controlled 或 cloud-approved 策略，将实际 provider ID 加入 `approvedRemoteIds`，并在 `approvedRemoteDataClasses` 中批准每个显式声明的 Session 数据分类；cloud-approved 还需要 `cloudApproval: true`。部署时对完整问题和候选分类，例如 `sessionDataClasses: [workspace]`；分类不能由模型提供。配置 endpoint 本身不代表批准出站。移除旧 `minConfidence` 和 `maxSelections`：启动时明确拒绝单选配置，不会静默缩小召回。

<a id="understand-the-implementation"></a>
## 理解实现

适配器将问题及前十六个候选放在一次有界请求中。独立 noul 答案估计相关性，不表示事实真伪或已校准准确率。active 对已评分前缀稳定排序，其余候选保持原位，低概率候选同样保留。profile 先追加 prepared unknown receipt，flush 所属 Session，再通过持久化后端读回该 receipt，之后才发送请求。settled receipt 关联 prepared 事件序号，保留完整请求和校验后响应。取消保留 prepared 状态，不伪造成功；缺少持久化能力或屏障 I/O 失败时禁止发送并保留 baseline。只有 prepared 在发送前保证持久化；settled 随 Session 常规 flush 保存。历史 version-one receipt 继续可读，回放不会调用 Jev。拥有 Session 的 `selectContinuumMemory` 使用方必须提供持久化 beforeDispatch checkpoint；仅无 Session 消费者可省略该参数并自行记录输入。checkpoint 挂起期间失效的生命周期或卸载的 selector 不能继续发送请求。已发送后卸载不会撤回请求；迟到的排序不再采用，主模型继续使用完整 baseline。

<a id="model-experience"></a>
## Model Experience

### 有界记忆相关性

#### 模型看到的内容

Jev 仅通过 `JevRequest.state` 和独立 `noul` 问题接收检索提供的问题及有界候选元数据。主模型接收所有此前通过预算的候选，仅在 active 模式下调整顺序。适配器不读取工作区文件。

#### Token effect

sidecar 最多发送一次请求，以完整 resolved JSON 字节数限制。排序保持候选集合及完整召回字节数，不缩短主模型上下文。

#### KV Cache effect

active 排序可能改变主模型 prompt 后缀；off 和 shadow 保持 baseline 顺序。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 适配器不负责检索或记录准入。profile service 只在 Continuum 提供的有限候选中选择，不会臆造事实。
- 真实 Jev 质量和延迟必须在 gateway 可达且配置完整时测试；fake provider 不能证明模型效果。
- 仅对前十六个候选评分，其余候选标记为未评分并保留。语义索引、查询扩展和逐条数据分类属于后续工作。声明的 Session 数据分类覆盖候选及问题；本包没有检测其中密钥的数据分类器。

<a id="dev-note"></a>
### 开发备注

本包保持实验性。system3 runtime patch 以 `off` 模式声明它；是否启用 Continuum 仍是受保护部署环境的显式选择。
