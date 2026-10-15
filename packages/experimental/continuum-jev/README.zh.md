---
description: "为 APUS 产品配置方案提供可编辑的 Session 记忆默认值和受保护的 Reflex/Jev 写入与相关性判断。"
kind: package-bundle
---

# @deepseek-ai/dsh-experimental-continuum-jev

[English](README.md) | 中文

## 概述

APUS Reflex Agent Full 和 Lite 包含此配置方案层，用户可从 Reflex 配置开启无损的 Session 记忆。Reflex 开启期间，压缩移出模型窗口的每条用户原话都由 Reflex 判断；之后仍需要的原话成为逐字保存的记忆记录，每轮只召回 Reflex 判断与新输入相关的记录，`history_read` 可以读回任何被压缩的原文。记忆默认关闭，Reflex 判断默认关闭且需要单独批准出站。未开启 Reflex 时，配置方案的行为与基础配置方案一致。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

### 选择配置方案层

APUS Desktop 和 Web 启动器为新建和已有普通配置方案选择已安装的此 bundle。其他配置方案通过[配置方案组合参考](../../boot/app-boot/README.zh.md)在 `dsh.profile.bundles` 中选择本包名称。[bundle 补丁](cordis.patch.yml) 在用户配置方案补丁下方挂载 `continuum-memory` 和 `continuum-jev` Reflex 服务。记忆运行需要单独挂载的 Reflex 提供方，并且 `continuum-jev` 处于 `shadow` 或 `active` 模式；Safe Mode 保留独立恢复配置方案。

打开**设置 → Reflex 配置 → Continuum 无限记忆**启用记忆，或保存以下配置方案补丁：

```yaml
- id: continuum-memory
  config:
    enabled: true
```

产品提供方默认记忆模式为 `active`、准入为 `compaction`、候选池为 `all`、作用域为 `workspace`，开关默认 false。已保存的部分字段配置保留这些默认值，明确设置的 `mode: off`、`admission: explicit` 或 `user-message`，以及空作用域仍然生效。无效开关修改不会改变已接受的设置。使用压缩准入时，只开启记忆不会改变任何行为，必须同时开启 Reflex：此后每次压缩都把它替换掉的用户原话交给 Reflex admitter，被采纳的原话成为保留 Session 原文引用的记录。关闭记忆或 Reflex 后停止新准入和召回，持久记录及会话历史中已记录的召回保留。重新打开同一 Session 会恢复其记录。此层不会自动合并无关 Session，也不授予任务记忆访问权。

### 配置 Reflex 判断

服务默认 `off`，隐私策略默认 `privacyPolicy: { mode: local-only }`。配置 `mode`、`selection`（默认 `rank`，bundle 设为 `threshold`）、`minRelevance`（默认 0.7）、`routeAbove`（默认 16）、`minRouteProbability`（默认 0.5）、`tags`（默认 8 个 personal agent 标签）、`minTagProbability`（默认 0.5）、`maxQuotedChars`（默认 600，打标问题引用长原话的开头和结尾）、`maxQueryChars`（默认 500）、`timeoutMs`（默认 2000）、`maxRequestBytes`（默认 32768，bundle 设为 65536）、`privacyPolicy` 及 `sessionDataClasses`（默认 null，拒绝出站）。`rank` 对所有召回候选重新排序；`threshold` 只保留相关性达到 `minRelevance` 的候选，没有 Reflex 答案时只保留与问题有共同词的候选。写入时对每条被压缩原话逐个标签提问，概率达到 `minTagProbability` 的标签都会被打上，只有至少有一个标签的原话才进入索引；默认标签为 `people`、`health`、`plans`、`dates`、`money`、`places`、`work` 和 `preferences`。`shadow` 记录两种判断，但索引全部被压缩原话，并按共同词召回。所有 Jev 路由均保守归为 network。授权时使用 controlled 或 cloud-approved 策略，将实际 provider ID 加入 `approvedRemoteIds`，并在 `approvedRemoteDataClasses` 中批准每个显式声明的 Session 数据分类；cloud-approved 还需要 `cloudApproval: true`。部署时对完整问题和候选分类，例如 `sessionDataClasses: [workspace]`；分类不能由模型提供。配置 endpoint 或打开记忆开关不代表批准出站。移除旧 `minConfidence` 和 `maxSelections`：启动时明确拒绝单选配置，不会静默缩小召回。已有完整组合的部署仍可直接挂载默认 `ContinuumJevPlugin` 服务。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

[产品记忆提供方](src/product-memory.ts) 继承 [Core 记忆实现](../../context/continuum/README.zh.md)，仅调整四个 schema 默认值，不改动 Core 默认值。Loader 组合和 ConfigForms 使用同一份经过校验的提供方配置。[Reflex 服务](src/index.ts) 在一次有界 Jev 请求中对前十六个召回候选评分；每个问题引用输入的前 `maxQueryChars` 个字符和候选摘录。独立 noul 答案估计相关性，不表示事实真伪或已校准准确率。`rank` 稳定排序已评分前缀并保留其余候选；`threshold` 保留达到 `minRelevance` 的已评分候选，以及与问题有共同词的未评分候选。使用 `threshold` 且候选数超过 `routeAbove` 时，先发一次路由请求，逐个标签判断回答当前输入是否需要这类记忆；随后只判断带有选中标签或没有标签的候选，一个标签都没选中时不召回。路由问题使用中文，写出每个标签的 `label` 和 `description`，这是在已部署模型上全部命中目标的措辞；路由请求和选中的标签都记录在判断回执中。在设置中关闭 Reflex 期间，选择和写入都记录 `provider-unavailable`，失败原因为 `reflex-disabled`：`rank` 保持基线顺序，`threshold` 不召回任何内容，写入不建立任何索引，行为与没有 Continuum 时一致；其他 Jev 配置错误和协议错误仍然失败。

只有在 `shadow` 或 `active` 模式且挂载了 Jev 提供方时，服务才提供 `continuumMemoryAdmitter`，并在同一作用域挂载 [`dsh-tool-history-recall`](../../session-query/tool-history-recall/README.zh.md)，因此 admitter 和历史工具同时出现、同时消失。admitter 为 L1 索引挑选并标记被压缩的用户原话：每条原话按每个标签各提一个逐字引用该原话的 Noul 问题，因此一次请求容纳 `floor(16 / 标签数)` 条原话（默认标签下为两条），每批记录为 `continuum/memory-admission`，包含被索引的 ID 及其标签。off、shadow 模式及任何失败都把整批原话以无标签方式索引；Core 不会因为 Reflex 失败而丢弃被压缩的原话。

两种判断都由 profile 先追加 prepared receipt，flush 所属 Session，再通过持久化后端确认读回的数据完全一致，之后才发送请求。settled receipt 关联 prepared 事件序号，保留完整请求和校验后响应。取消保留 prepared 状态，不伪造成功；缺少持久化能力或屏障 I/O 失败时禁止发送并保留 baseline。只有 prepared 在发送前保证持久化；settled 随 Session 常规 flush 保存。历史 version-one receipt 继续可读，回放不会调用 Jev。拥有 Session 的 `selectContinuumMemory` 使用方必须提供持久化 beforeDispatch checkpoint；仅无 Session 消费者可省略该参数并自行记录输入。checkpoint 挂起期间失效的生命周期或卸载的 selector 不能继续发送请求。已发送后卸载不会撤回请求；迟到的排序不再采用，主模型继续使用完整 baseline。

</details>

<a id="model-experience"></a>
## Model Experience

### 有界记忆相关性

#### 模型看到的内容

主模型在显式开启后接收 Core 提供的、保留原文引用的有界召回；使用 `threshold` 选择时，召回只包含 Reflex 判断与当前输入相关的记录，每条都给出供 `history_read` 使用的来源事件。获得出站批准后，Jev 看到独立的 `noul` 问题：相关性问题引用输入的前几个字符和一段有界摘录，写入问题引用一条完整的被压缩原话。服务不读取工作区文件。

#### Token effect

每轮最多发送一次相关性请求，每次压缩按每十六条被压缩原话发送一次写入请求，均以完整 resolved JSON 字节数限制。`rank` 保持候选集合及召回字节数；`threshold` 去掉无关候选，因此无关输入不会增加召回文本。

#### KV Cache effect

召回是追加在已有历史之后的新消息，已有请求前缀保持稳定；不同的选择结果只影响追加的召回内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 在设置中关闭 Reflex 期间，写入仍会记录 `provider-unavailable` 回执；不会产生索引项或召回，也不提供 `history_read` 和 `history_search`，重新开启 Reflex 后下一次请求恢复这两个工具。
- 服务不负责检索或记录。Core 负责 bundle 中基于 Session 的记录和生命周期；Reflex 判断不表示事实成立。
- 真实 Jev 质量和延迟必须在 gateway 可达且配置完整时测试；fake provider 不能证明模型效果。真实 headless 验收覆盖一个约束召回场景，`minRelevance` 和 `minTagProbability` 尚未用标注集校准。相关性请求位于每轮的关键路径上。
- 仅对前十六个候选评分；`rank` 保留其余候选，`threshold` 只保留其中与问题有共同词的候选。语义索引、查询扩展和逐条数据分类属于后续工作。声明的 Session 数据分类覆盖候选及问题；本包没有检测其中密钥的数据分类器。

不发布运行时不变式伴生模块：请求与回执适配器不维护独立的持久投影。

<a id="dev-note"></a>
### 开发备注

本包保持实验性。产品记忆需要显式开启，Reflex 判断默认关闭。服务器部署保留自身的显式组合和隐私策略。
