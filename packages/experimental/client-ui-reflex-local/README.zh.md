---
description: "在 Bundle 页面准备并启用本机判断，同一时刻只有一个主操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-reflex-local

[English](README.md) | 中文

## 概述

此可选浏览器插件在 Bundle 页面渲染本机决策引擎卡片，开启 Bundle 时提供一键下载，在输入框上方显示后台准备状态，并在本机判断启用时以带撤销操作的提示告知。所有界面共享一个 Host 就绪订阅。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件管理页启用[本机决策引擎 Bundle](../reflex-local-bundle/README.zh.md)。这台 Mac 能运行引擎且尚未下载模型时，弹窗提供带下载大小的“下载并启用”或“稍后”；可用空间不足时改为打开详情。卡片同一时刻只有一个主操作：下载前为“下载并启用”，下载中为“暂停”与“取消”，暂停后为“继续下载”，启用后为“停用”与“删除模型”，下载完成未启用时为“启用”（较慢的 Mac 上为“仍要启用”），失败后为“重试”。无法运行引擎的设备显示原因，不提供操作。可用空间放不下推荐档时，禁用的主按钮写明需要与可用的空间，精简版放得下时“改用精简版”下载较小的量化档。仅当 Host 公布多个下载源时，“下载来源”下才出现选择。下载进行中、已暂停或正在检查时，以及较慢的 Mac 等待决定时，输入框上方的标签显示当前状态；其菜单按状态提供“暂停”或“继续下载”、“取消”、“仍要启用”与“查看详情”。“暂不启用”在页面重新加载前隐藏较慢 Mac 的标签，不改变 Host 状态。自检自动启用本机判断时，提示条显示“判断已在本机进行”并提供“撤销”，撤销即停用；当时没有打开页面的话，下次加载时显示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

插件挂载生成的 `reflexLocal` Remote 并注册四个条目：以 Bundle 名为键的 `plugins.bundle.config` 与 `plugins.bundle.activation`，顺序为 6、在上述状态之外不渲染任何内容的 `conversation.input.dock` 标签，以及生命周期长于插件页面、同时报告标签命令失败的 `shell.overlay` 提示。一个就绪镜像经网关流自动重连，断线期间保留最后的快照。Host 把自动启用记为 `unacknowledgedAutoEnableAt` 并跨重启保留，因此自检期间关闭的页面之后仍会收到提示：插件对每个标记值只显示一次，并在提示关闭时调用 `acknowledge()`，因此提示可见期间关闭的页面下次会再次提示；“撤销”调用 `disable()`，同时清除该标记。命令失败在卡片或弹窗内就地显示。就绪来自一个 Host 订阅且提示只有一个拥有者，因此不发布运行时不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[本机决策引擎体验设计](../../../docs/feat-local-jev-mlx/local-inference-experience.html)

-----

<a id="model-experience"></a>
## 模型体验

无，因为卡片、弹窗与提示只控制准备与启用；Jev 判断只经由既有消费方影响模型。

#### KV 缓存影响

没有直接影响；插件不向任何请求前缀添加内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 体验设计中的邀请卡与判断来源徽标尚未实现；只能在 Bundle 页面开始下载。
- 进度使用原生 `progress` 元素，因为基础组件中没有进度组件。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
