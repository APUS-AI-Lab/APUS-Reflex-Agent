# AG-UI 默认产品隔离修复

目标：默认生产安装不携带 experimental AG-UI；保留源码检出的显式 AG-UI 组合。

文件：apps/cli/package.json、pnpm-lock.yaml、packages/experimental/agui/cordis.patch.yml、AG-UI README 双语及配对。

修复：CLI 的 AG-UI 依赖移到 devDependencies；overlay 使用相对构建入口 ./lib/index.js（与 experimental inspector 相同）。profile resolver 只暴露运行依赖，因此仅移动依赖仍会令裸包名导入失败；相对入口由 overlay 所在目录解析，不放宽 resolver 或默认产品隔离规则。README 明确该 overlay 仅用于已构建源码检出，不宣称默认安装或可安装 profile bundle 支持。

已验证：离线 lockfile 更新及 frozen 安装通过；pnpm run build 通过（/private/tmp/agui-isolation-build.log）；默认隔离检查通过；相关 Vitest 4 files / 102 tests 通过；205 个 Cordis 配置通过；AG-UI built persona SDK snapshot 在最终 build 后通过；README 配对通过。module graph、dependency catalog 和 doc graphs 已执行生成。

真实 Web smoke：官方 built CLI 加相对 AG-UI overlay，在独立临时 DSH_HOME、OS 分配端口上启动；GET /agui/threads 无令牌返回 401，固定测试 Bearer 返回 200 和空 threads。未调用模型，未读取或创建持久凭据；进程退出、临时目录已清理。首轮基于按行 select 的脚本漏读缓冲输出，后续使用 os.read；第二轮准确发现裸包名导入失败，再改为相对入口后通过。

根 agent 负责 todo/handoff 以及最终 doc-sync/lint/Ruff；本任务不提交、不推送、不触发远端 CI。远端 main Actions run 36562864544 因 Actions budget 阻止启动，feature 分支暂无 workflow run，不能将此状态称为测试失败或远端通过。
