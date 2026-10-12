# PPT 来源与模板替换建议

审查日期：2026-09-06。当时的开发 worktree 基线：`9d4502f`；当前核心包为 `dsh-ppt`，插件为 `dsh-ppt-composer`。下文保留清理前的来源审查和历史包名；最新处理结果如下。

## 发布状态（2026-09-08 更新）

下述命名调整、模板清理与扩展、版式精修和校验反馈优化，已通过 [PR #328](https://github.com/dataelement/dsh-desktop/pull/328) 和 [PR #332](https://github.com/dataelement/dsh-desktop/pull/332) 合并，并包含在 [0.8.0-rc.3](https://github.com/dataelement/dsh-desktop/releases/tag/0.8.0-rc.3) 中。当前维护说明见 [PPT runtime README](../packages/ppt-runtime/README.md)。以下测试数字和未验证项保留为各阶段的历史记录。

## 后续：命名与十套模板接入

- 插件更名为 `dsh-ppt-composer`，核心为 `dsh-ppt`；Skill、主 RPC、新记录及分发目录统一 DSH 命名。历史研究来源仍在代码入口注释和 THIRD_PARTY_NOTICES.md 中说明。
- 保留旧存储路径、RPC 别名及旧提示词清理逻辑，保护已有会话/文件；三套仍保留的旧模板 ID 平滑映射到新 ID，不误报下架。
- 新增 Zara 的 Soft Editorial、Editorial Forest、Signal、Blue Professional、Broadside、Monochrome、Neo-Grid Bold、Sakura Chroma、Playful、Cartesian。固定提交 `e5e204fb1f3b06290846e7dcd7aceddabeceec8c`，保留 MIT 版权和许可；每套现已扩展为 12 个原生可编辑版式，并非整份 HTML 逐页转换。
- 当前共 **16 套、192 个版式**，全部预览采用英文；附对应中文源页，共 384 页双语示例。每套注明英文/中文标题与正文字体、Windows/macOS/Linux 回退；不内嵌或分发字体文件。
- 验证：725 项测试、类型检查和构建通过；32 个双语工程、384 页源检查无错误或警告，32 份 PPTX 成功导出。Keynote 实测英文 Sakura、中文 Signal 可编辑且无缺失字体提示；修复了引擎默认 MiSans 依赖和英文单词断行。开发版实测插件新名称、16 套英文预览及选择交互。尚未验证 Windows 原生包或 PowerPoint，也未调用模型完成端到端生成。
- 版式扩展已覆盖全部模板：图表解读、假设树、时序与网络、案例对比、教学评价和执行计划。补充 Keynote 中文教学评价页抽查；保留三套行业模板的原有页面。连续重建的模板源文件、元数据和设计说明一致。
- 来源、构建和兼容说明见 `packages/ppt-runtime/README.md`。以下六套模板清理结果为上一阶段记录。

## 本轮已实施

- 已从当前 core/adapter 归档移除 23 套未核清来源的模板、345 张参考图，以及关联指南、内嵌预览和模板数据；旧归档也已移出当前分支。
- 保留 3 套附原生 PPTD 的自建模板，检查其源元素和资源，修复两处标题溢出；新增工程蓝图、课程培训、原创编辑手记，共 6 套 54 页。
- 重写 Skill、PPTD 用法和组合说明；记录历史研究来源，保留适用许可。工程蓝图/课程培训保留 Apache-2.0 许可及上游文件，不复用 Guizang 模板。
- 旧选择回退到工程蓝图并提示；保留用户文稿和文件。旧自动 Skill 快照会在后续运行时被新版说明替换；PPT 未选中时仍不污染自定义预设。
- 可维护分发源码、模板源文件、来源和哈希清单已纳入 `packages/ppt-runtime/`；附重建脚本，避免依赖临时 `node_modules` 修改。
- 720 项测试、类型检查和构建通过；54 页均通过源检查，6 个 PPTX 已成功导出并确认含可编辑元素。开发版界面已实测只显示六套模板且选择正常；Keynote 实测工程蓝图的中文封面、流程页显示正常，文字仍为可编辑文本框。尚未验证 Windows 原生包及 PowerPoint。

该阶段完成时，模板/文档清理尚未发布或合并（后续发布状态见上文）；没有重写历史 Git/Release，也不将本轮工程检查称为整个引擎或全部历史分发已获得法律确认。

## 清理前审查结论

**有明确的版权与许可链风险，建议下一版停止捆绑授权未核清的 23 套模板，共 345 张 JPG 及关联派生内容。当前证据不足以直接认定侵权，也不足以证明这些素材可以随产品再分发。**

当前共 26 套、375 张 JPG：21 套社区来源（159 张）、2 套用户提供的木友圈模板（186 张）、3 套声明为原创的模板（30 张）。社区模板的实际权利人未必是 Kimi，可能涉及原报告作者、设计师及图片权利人；仅改名或注明参考不能补足授权。

- 原 `Binaryify/open-kimi-ppt-skill` 仓库已声明因版权原因清空。这是风险信号，不是对每个文件侵权的司法认定。[原仓库声明](https://raw.githubusercontent.com/Binaryify/open-kimi-ppt-skill/main/README.md)
- 当前包的 `THIRD_PARTY_NOTICES.md` 承认：设计指南、参考图及派生裁切来自 `E1nzbern/open-kimi-ppt-skill@07eeaad`；PPTD 工作流与文档结构参考 `c32890f`。社区作者的 MIT 声明不能单独证明其有权许可全部上游素材。
- 复制、改编和传播具体文档、图片需要核对权利；软件思想、处理过程和操作方法不因软件著作权而被垄断。可以保留经核实的自有引擎，不能据此推定模板、文档也可复制。[著作权法](https://www.ncac.gov.cn/xxfb/flfg/flfg_532/202103/t20210309_50530.html)、[计算机软件保护条例第六条](https://tfs.mofcom.gov.cn/fgsjk/flfg/zscq/zzq/art/2024/art_d071637de09e4ca88b627f924a7280c3.html)

## 具体模板文件

以下路径均相对于 `node_modules/dsh-kimi-ppt/skills/kimi-ppt/references/`。每个目录的处理范围包含 `design.md`、`pages/*.jpg`，以及编译产物中的相关预览、语义和几何数据。

### 建议移除：21 套社区来源

| 目录 | 模板子目录 |
| --- | --- |
| `academic/` | `curated-blue-line-courseware`、`curated-pastel-derivation`、`curated-wine-red-data` |
| `business/` | `indexed-ink-green-market-trends`、`indexed-orange-tech`、`indexed-xuan-paper-annual` |
| `consulting/` | `curated-apricot-white-brief`、`curated-indigo-due-diligence`、`curated-moss-green-transformation` |
| `finance/` | `curated-black-gold-ledger`、`curated-lake-blue-memo`、`curated-prospect-annual` |
| `promotion/` | `curated-aqua-charity-report`、`curated-cream-collage`、`indexed-gold-orange-type-journal` |
| `strategy/` | `indexed-dusk-violet-consulting`、`indexed-map-strategy`、`indexed-red-black-business` |
| `work/` | `curated-blue-flame-brand`、`curated-moon-white-imagery`、`indexed-color-stripes-documentary` |

### 建议一并暂停捆绑：2 套木友圈来源

| 目录 | 直接来源与问题 |
| --- | --- |
| `business/curated-vitality-blue/` | 用户提供的《活力蓝-定制级【逻辑图表】PPT灵感手册58页-木友圈.pptx》。`design.md` 记录移除共享母版右上角 logo，并保留其他内容；没有看到产品再分发授权。 |
| `work/curated-cobalt-work-atlas/` | 用户提供的《定制级【工作型】PPT灵感手册128页-木友圈.pptx》。包中包含 128 张页面参考图；没有看到产品再分发授权。 |

“购买或提供模板”“仅作为模型参考”“不把原图用于最终 PPT”均不能单独证明可以把参考图打包发给所有用户；去 logo 不产生授权。

### 优先保留候选：3 套声明原创

`work/curated-modular-logistics-system/`（模块化物流系统）、`consulting/curated-swiss-signal-grid/`（瑞士信号网格）、`work/curated-nordic-operating-report/`（北欧经营报告）。

三套均附自建 PPTD 源工程、10 张预览和来源说明，称只参考通用设计规律，没有复制外部模板文件、图片或品牌资产。当前证据比前 23 套更好，但声明本身不等于完成原创性或授权核验；还应留存创作提交和外部参考记录，确认未复刻受保护的具体表达。

## 替代来源：html-anything

已读任务“主力开发5”的最近一轮讨论。核对版本为 [`nexu-io/html-anything@c312045`](https://github.com/nexu-io/html-anything/tree/c31204544230578ac814026fecc153c6e36587ae)，根许可证为 Apache-2.0。

| 候选 | 建议 |
| --- | --- |
| `deck-blueprint` | 优先评估。所查 Skill 未标明额外第三方来源；规则较短，需要自行补足 PPTD 版式、示例和预览。 |
| `deck-course-module` | 优先评估。自行补齐课程目标、案例、自测、总结等版式；新示例使用自有文字和矢量图形。 |
| `deck-guizang-editorial` | 暂缓直接复用。Skill 明确引用 `op7418/guizang-ppt-skill`，其当前许可证为 AGPL-3.0；须核对所引版本、实际复制内容、是否另有授权，以及适用的分发义务。不能简单按根目录 Apache-2.0 搬用。 |

AGPL 不等于禁止商用，也不能仅因“参考风格”就断言整个产品必须改用 AGPL。建议自行设计编辑部风格模板，避免直接复制上述 Skill、代码及成套版式表达。[编辑部来源声明](https://github.com/nexu-io/html-anything/blob/c31204544230578ac814026fecc153c6e36587ae/next/src/lib/templates/skills/deck-guizang-editorial/SKILL.md)、[其上游当前许可证](https://github.com/op7418/guizang-ppt-skill/blob/main/LICENSE)

复用确认适用 Apache-2.0 的文件时，保留许可证、适用署名和 NOTICE，标注修改；独立核对字体、图片等素材。转写为 PPTD 不会自动消除原文件的许可义务。[Apache-2.0 第 4 节](https://www.apache.org/licenses/LICENSE-2.0)

## 落地范围

1. 先核验上述 3 套自建模板，形成可分发清单；再加入工程蓝图、课程培训和独立设计的编辑部模板，保持可编辑 PPTX 能力。
2. 从 core/adapter 的源工程删除被排除模板、目录项、默认选择、参考图、前端 Base64 预览、逐页语义和几何索引，重新生成归档。当前两个包的 `lib/client.js` 均有内嵌图片，不能只删除 JPG 或隐藏选择器。
3. 旧会话的失效模板 ID 回退到可用模板并提示，不删除用户已经生成的文件。检查安装包和加载路径，确保旧归档、缓存不会继续提供被排除素材。
4. 另行重写来源不清的 Skill／`references/pptd.md` 等参考文档，依据自有实现描述能力；保留真实来源记录和仍适用的版权通知。模板替换不能被称为整项功能已完成版权清理。

补充开发证据：Jianghan 的 8 月 26–27 日会话显示，曾直接研究本机 Kimi 客户端附带的 Skill、PPTD/CLI 文档和编译程序，并用 Kimi 生成的 PPTD 测试自有 TypeScript/PptxGenJS 转换器。可见会话截至 9 月 2 日，最终集成以 [PR #297](https://github.com/dataelement/dsh-desktop/pull/297) 和当前包内声明补充核对；不能仅以 `clean-room` 注释替代开发来源证据。

本报告是工程来源审查和风险分级。最终侵权判断及特定授权范围应由法务结合原始合同、文件与适用法确认。
