# APUS Reflex Harness

[English](README.md) | 中文

> **瞬策 · 瞬时执行，深度思考。** APUS Reflex Harness 以 Model as Harness 为目标，由大小脑混合模型管理工具、技能、记忆、上下文与子 Agent；DSH 运行时负责执行、权限与事实记录。各项能力的接入和验证范围见下文。

共享资产、兼容标识与服务归属见[品牌定义与装配说明](docs/feat-apus-brand/branding.zh.md)。

## 架构

这个架构把即时决策模型和持久执行 Harness 融合在一起。**Reflex/Jev 是小脑：**负责入口、路由、记忆准入、恢复和监督等有界且低延迟的判断。**DSH 是大脑的工作 Harness：**通过模型完成开放式推理和生成，再负责工具、技能、子 Agent、权限、生命周期和事实记录。两者共享原生任务状态、决策记录和动作归属。入口选模需要显式配置候选与隐私策略；仅挂载决策 provider 不会启用它。

![Jev Native + DSH Native：第一目标为入口策略与调度，第二目标为过程智能，共享原生决策与结果反馈。](docs/feat-independent-harness/architecture@2x.png)

[Loop Working 架构（小脑 + Harness + 无限记忆）](docs/dev-continuum-reflex-integration/apus-reflex-loop-working-architecture.html) · [SVG 源文件](docs/feat-independent-harness/architecture.svg) · [Jev Native + DSH Native 专项方案](docs/feat-independent-harness/jev-native-dsh-native-plan.html)

当前实现支持空闲 Web/API 文本入口的 Fidoo LiteLLM 选模、原生模型步骤前的有界 Skill 选择，以及区分建议、采用、模型响应和 Skill 注入的 Conversation 界面。APUS Reflex 层还提供专用 Reflex 模型配置页、可逆上下文投影与恢复、cache/Session 前缀保护，以及有界 Codex Goal 监督。参见[实施与验收范围](docs/feat-system3-g1/implementation.zh.md)、[部署指南](docs/feat-system3-g1/deployment.zh.md)、[System3 配置及限制](packages/experimental/system3/README.zh.md)和[专家级验收报告](docs/feat-reflex-control/apus-reflex-harness-acceptance-review.html)。严格受控监督链路和代表性上下文恢复已有验证；健康长任务对照、中途修改 Goal、远端首字节/回退和签名发布包仍待完成。Pilot 保留为实验参考。

## 从 Personal Agent 到 Loop Working

多数 Agent 只回答一次请求，并丢失让答案持续有用的工作状态。APUS Reflex Harness 面向能够持续推进工作的 **Personal Agent**：理解意图，选择路径，通过工具和技能执行，记录发生的事实，恢复相关状态，再从尚未完成的下一步继续工作。我们把这个循环称为 **Loop Working**。

Loop Working 成立的关键，是把持久记忆和模型单次请求的有限窗口分开：

- **无限记忆：** 持久 Session 记录、索引引用、摘要和检索策略让工作事实跨轮次、跨进程和跨重启可用。
- **无损输入：** 用户原始消息和准入事实会在投影、路由或摘要改变模型可见内容之前记录下来。
- **无损记忆：** 原始 Session 和 cache 安全的已提交前缀保持不变；之后的上下文投影可以追加可恢复引用，而不改写历史。

因此，“无限上下文”指的是近似无界且可恢复的工作历史，以及每一步有界的模型投影；它不表示任何模型在一次请求中可以接收无限 token。Harness 为当前步骤选择相关证据，同时保留源事实供后续恢复和审计。

## 两条决策模型路径

同一个 Personal Agent 支持两种部署选择：

1. **Reflex 路径：** 挂载并显式启用 Jev/Reflex provider 后，由低延迟专用决策模型处理入口路由、记忆准入、上下文恢复和监督等有界选择。系统可以先记录 shadow 决策再激活采用，最终决策及其来源会写入 Session。
2. **通用模型路径：** 没有 Jev 或关闭 Reflex 开关时，原版 DSH 行为仍可使用。通用模型、显式规则和已配置路由仍能执行任务；运行时不要求 Reflex endpoint 才能开始工作。

这种分离让决策延迟和生成质量彼此独立。Reflex 在狭窄且可审计的约束内做判断；通用模型负责开放式推理和生成；DSH 负责工具、权限、子进程、技能、子 Agent 和持久执行。

## 架构如何支撑循环工程

1. **输入与准入：** 把用户请求作为 Session 事实保存，并判断该消息是否可以成为持久记忆。
2. **Reflex 或配置路由：** 选择允许的模型、Codex 路径或恢复动作，并记录决策的作用域和来源。
3. **Harness 执行：** 在 DSH 权限下运行工具、技能和子 Agent，负责生命周期、取消和动作结果，而不是让模型模拟这些能力。
4. **Continuum 记忆：** 写入持久记录，维护索引摘要并检索相关引用；原始 Session 始终是事实源。
5. **上下文投影：** 根据引用生成有界请求，只编辑尚未提交且未冻结的尾部，并保留可被 provider cache 复用的已提交前缀。
6. **结果反馈：** 记录模型可见输入、动作和结果，让下一轮能够恢复、验证改善，或安全地等待新的用户指令。

这样得到的 Personal Agent 可以持续工作，但不会把记忆、模型窗口或单次决策假设成永久不变。[Continuum 记忆 E2E](apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts)、[System3 Reflex 上下文测试](packages/experimental/system3/tests/reflex-context.spec.ts)和[经典案例集](docs/dev-continuum-reflex-integration/classic-cases.html)记录了当前证据与已知限制。

## APUS Reflex 能力指南

- **入口路由：** 用户输入准入后，Reflex 可以在允许的模型或 Codex 路径中选择去向；本地 admission/status 和路由决策测量记录在[验收清单](docs/feat-reflex-control/acceptance-checklist.zh.md)中。
- **Reflex 模型配置：** Web 与 Electron 共用专用的**Reflex 模型配置**页面。provider、模型和 effort 设置会持久化并被真实请求使用，详见 [System3 API/配置参考](packages/experimental/system3/README.zh.md)。
- **上下文与 cache 安全：** 按行/片段投影只编辑未提交且未冻结的请求尾部，通过追加可恢复引用恢复内容，并保留原始 Session 日志和 cache 前缀。[cache 基准设计](docs/feat-reflex-control/cache-benchmark-design.zh.md)说明了边界。
- **Codex 监督：** 监督保持轻量，使用有界证据、一次带来源调整和调整后的验证。[严格 v6 证据](docs/feat-reflex-control/evidence/semantic-codex-strict-final-v6.zh.md)是用户流程参考，不代表所有健康长任务都会自动纠偏。
- **发布状态：** 当前变更和已知限制见[发布说明](docs/feat-reflex-control/release-notes.zh.md)。当前开发预览版本不能当作安全边界。

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

上游 DeepSeek Harness 文档（不是 APUS 构建指南）：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。发现漏洞请按[安全政策](SECURITY.md)私下报告，不要在公开 Issue 中披露。

<a id="run"></a>

## 运行

### 通过 `npm` 运行上游发行版

下面的 npm 包是上游发行版，不会安装 APUS Reflex Harness，也不包含本 fork 的 Jev 扩展。安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

<a id="run-from-source"></a>
### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/cryptoSUN2049/APUS-Reflex-Harness.git
cd APUS-Reflex-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Issues](https://github.com/cryptoSUN2049/APUS-Reflex-Harness/issues) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)。完整保留 DeepSeek 原始版权声明与许可文本。

感谢 DeepSeek 及 DeepSeek Harness 贡献者提供上游 Agent 运行时，感谢 Shigma 与 Cordis 贡献者提供插件框架，也感谢为 APUS Reflex Harness 提供基础组件的第三方维护者。APUS 品牌不替代原作者署名，也不代表获得其背书。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
