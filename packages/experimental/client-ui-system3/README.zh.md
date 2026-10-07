---
description: "通过显式配置为原生 Web 与桌面对话提供 System3 执行反馈。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-system3

[English](README.md) | 中文

## 概述

这个可选 Client 插件增加紧凑的原生 Conversation 区块。它分别呈现本地提交反馈与持久化的 System3 建议、Host 采用、实际模型响应和 Skill 注入事实。它还在原生轮次标题（`conversation.chat.turnHead`）中提供一行路由说明：该轮次的入口决策记录到达时，立即写明由谁处理、延续上一轮的路由或回退使用的模型；区块保留调度模式、委派阶段和委派运行的进度，包括启动中和复核结果阶段。Web 与桌面通过产品 profile 加载同一插件。

## 目录

- [配置](#configuration)
- [行为](#behavior)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [模型体验](#model-experience)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

将这个 Host 发现入口与 System3、原生 Conversation Client 插件一起加载。本包没有部署设置。产品 profile 负责 Jev、生成模型路由和数据权限。界面文案由类型化的中英文字典管理。

<a id="behavior"></a>
## 行为

区块订阅原生 Session 和投影。本地提交在路由结束前显示。执行状态独立于历史入口建议，跟随实时 Session；历史回放后仍可查看决策详情。轮次结束不代表交付物已通过验证。固定模型操作调用原生重置 API，并等待持久模式改变；调用失败保留当前显示模式。被寻址的子智能体不能修改根会话模型选择。

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
