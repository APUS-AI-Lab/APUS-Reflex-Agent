---
description: "通过显式配置为原生 Web 与桌面对话提供 System3 执行反馈。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-system3

[English](README.md) | 中文

## 概述

这个可选 Client 插件增加紧凑的原生 Conversation 区块。它分别呈现本地提交反馈与持久化的 System3 建议、Host 采用、实际模型响应和 Skill 注入事实。它还在原生轮次标题（`conversation.chat.turnHead`）中提供一行路由说明：该轮次的入口决策记录到达时，立即写明由谁处理、延续上一轮的路由或回退使用的模型，更早的轮次依据投影的 `history` 保留各自的路由说明。运行中的轮次把任务交给子 agent 时，输入框 `conversation.input.right` 位置的条目在模型选择器旁写明委派对象，模型选择器仍显示负责协调的模型。区块保留调度模式、委派阶段和委派运行的进度，包括启动中和复核结果阶段。Web 与桌面通过产品 profile 加载同一插件。

## 目录

- [配置](#configuration)
- [Reflex 模型配置](#reflex-model-configuration)
- [行为](#behavior)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [模型体验](#model-experience)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

将这个 Host 发现入口与 System3、原生 Conversation Client 插件一起加载。本包没有部署设置。产品 profile 负责 Jev、生成模型路由和数据权限。界面文案由类型化的中英文字典管理。

<a id="behavior"></a>
## 行为

产品标题为 APUS Reflex Harness；`system3` 插件与 locale 标识保持不变。

更早的轮次依据投影的 `history` 保留各自的路由说明。运行中的轮次把任务交给子 agent 时，输入框 `conversation.input.right` 位置的条目在模型选择器旁写明委派对象，模型选择器仍显示负责协调的模型。区块订阅原生 Session 和投影。本地提交在路由结束前显示。执行状态独立于历史入口建议，跟随实时 Session；历史回放后仍可查看决策详情。轮次结束不代表交付物已通过验证。监督送达未确认时，文案说明缺少回执且未重复发送，不声称 Reflex 没有作出判断。固定模型操作调用原生重置 API，并等待持久模式改变；调用失败保留当前显示模式。被寻址的子智能体不能修改根会话模型选择。委派运行接受运行中输入时，区块提供补充说明表单，通过原生 `subagents.steerByParent` Remote 发送用户文本；发送被拒绝时保留文本并显示提示，Host 记录后已接受的文本显示在运行下方。

<a id="reflex-model-configuration"></a>
## Reflex 模型配置

本实验性客户端自行挂载 Reflex 的类型化 Remote；通用 API Remotes 不依赖该实验模块。客户端卸载时先撤销界面，再撤销 Remote。

Web/Electron 共享客户端将“设置 → Reflex 模型配置”注册为独立顶级页面。页面暂存服务地址、模型、OpenJev/Typesafe 协议、决策强度、超时和凭据引用，通过 ConfigForms/Credentials 保存，通过鉴权后的 `reflex` Remote 命名空间按草稿所选协议测试未保存的配置。协议以 `openjev` 或 `typesafe` 保存，修改协议使旧探测结果失效；Typesafe 不发送 effort 扩展或要求 `/health`。凭据原文不会回读或写入浏览器存储。部署环境提供的密钥保持只读；用户可通过独立的受管理引用保存替代密钥。

保存新 API Key 前，页面先检查凭据引用；若引用已配置，则拒绝覆盖，配置与密钥均不修改。轮换密钥必须使用新的专用引用名。

首次配置时，即使决策服务尚未配置，地址与模型字段仍可编辑；草稿测试通过不会改变已存配置状态，保存成功后才刷新为已配置。运行状态查询失败单独显示，不把已成功保存误报为失败。

连接结果与能力状态分别呈现。修改草稿后旧检测结果失效，旧草稿的延迟响应会被丢弃。即使已有旧密钥，凭据写入被拒绝也会显示保存失败。能力标签来自实际模块与启用状态，不从连接成功推断执行已验收。

目标相关性监督单独报告 `semanticSupervision.enabled` 状态。只有监督模块已安装、处于 active 模式、显式配置语义证据且当前工作区数据策略允许时才启用。该子能力未启用时，操作指纹监督仍可启用；两种状态均不代表已验证执行效果。

连接配置与密钥组合保存无法确认凭据写入时，页面仅在本轮已确认版本上恢复配置字段。较新的并发修改不会被覆盖，此时显示部分保存提示而非普通失败。草稿继续保留，重新打开页面读取已接受设置。配置与凭据属于独立服务，断连时不承诺跨服务原子性。

<a id="model-experience"></a>

## 模型体验

无，因为这个浏览器插件不新增模型可见输入。它呈现 System3 提供的 Client 安全事实，仅在用户操作时调用现有 Session controller。

#### KV Cache 影响

无直接影响；后续请求变化由原生模型选择负责。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 建议不等于执行。只有精确对应的指令消息提交后，Skill 才显示为已注入。区块不显示虚构百分比、定时成功、私有提示正文或 provider 概率。用户固定模型后，之前的自动决策仍属于历史记录。原生工具、交付物、错误、取消、目标和专家会话继续由各自现有 UI 负责。

<a id="dev-note"></a>
### 开发备注

**运行时不变量：** 不发布 companion。运行事实由 Host 投影拥有；本包只拥有可释放的 Conversation 插槽注册。
