---
description: "通过带认证的 Web Remote 提供本机决策引擎的准备与启用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-reflex-local

[English](README.md) | 中文

## 概述

`reflexLocal` Remote 将浏览器连接至 `ctx.reflexLocal`。它以流的形式提供设备支持、准备与启用快照，并转发准备、暂停、取消、启用、停用与删除命令。

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

与本机决策引擎服务和 Typert 组合。浏览器 UI 启用时挂载本包生成的 `/remote` 贡献。`prepare({ variant, downloadSource })` 将一个量化档和一个公布的下载源转发给引擎；省略时使用设备推荐档与配置的下载源。任务进行中变更量化档或下载源会被引擎拒绝，拒绝原样返回调用方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`follow()` 在一次客户端观察的生命周期内推送完整快照；观察方断开不会取消 Host 拥有的准备任务。其他方法直接委托服务、不增加状态，因此不发布运行时不变量伴随模块。控制器不抛出 `RemoteError`；Host 拒绝以携带服务消息的 `gateway/internal` 失败到达客户端。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[本机决策引擎体验设计](../../../docs/feat-local-jev-mlx/local-inference-experience.html)

-----

<a id="model-experience"></a>
## 模型体验

无，因为准备状态与命令不进入模型请求；Jev 判断只经由既有消费方影响模型。

#### KV 缓存影响

没有直接影响；控制器不向任何请求前缀添加内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此命名空间不提供逐次判断的历史；判断回执保存在 System3 写入的会话日志中。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
