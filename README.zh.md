# APUS Reflex Harness

[English](README.md) | 中文

> **瞬策 · 瞬时执行，深度思考。** APUS Reflex Harness 以 Model as Harness 为目标，由大小脑混合模型管理工具、技能、记忆、上下文与子 Agent；DSH 运行时负责执行、权限与事实记录。各项能力的接入和验证范围见下文。

共享资产、兼容标识与服务归属见[品牌定义与装配说明](docs/feat-apus-brand/branding.zh.md)。

## 架构

第一目标是 **Jev 入口策略决策与调度**：用户输入后选择允许的处理路径，由 DSH 交给适合的模型或专业 Agent。第二目标是**执行环节更智能、更顺畅**，逐步增强证据、记忆、恢复、升级与目标判断。两者共享原生任务状态、决策记录和动作归属；规则处理确定情况，System2 承担开放推理与生成。入口选模需要显式配置候选与隐私策略；仅挂载决策 provider 不会启用它。

![Jev Native + DSH Native：第一目标为入口策略与调度，第二目标为过程智能，共享原生决策与结果反馈。](docs/feat-independent-harness/architecture@2x.png)

[SVG 源文件](docs/feat-independent-harness/architecture.svg) · [Jev Native + DSH Native 专项方案](docs/feat-independent-harness/jev-native-dsh-native-plan.html)

当前实现支持空闲 Web/API 文本入口的 Fidoo LiteLLM 选模、原生模型步骤前的有界 Skill 选择，以及区分建议、采用、模型响应和 Skill 注入的 Conversation 界面。参见[实施与验收范围](docs/feat-system3-g1/implementation.zh.md)、[部署指南](docs/feat-system3-g1/deployment.zh.md)与 [System3 配置及限制](packages/experimental/system3/README.zh.md)。专业交接、排队入口路由、Jev 驱动的记忆与持续 Goal 判断、本地 9B／27B Lead Agent 仍需进一步接入和验证。Pilot 保留为实验参考。

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

上游 DeepSeek Harness 文档（不是 APUS 构建指南）：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

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
