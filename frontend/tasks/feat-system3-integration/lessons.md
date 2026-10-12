# Lessons

## Inspect every eligible workflow job before describing coverage

The macOS job condition does not define the Windows job condition. Inspect all job-level conditions and dependencies before claiming that a PR runs only dispatch validation. An unstarted budget-blocked predecessor can make downstream jobs appear skipped even when their event condition admits the PR. Preserve existing native verification and diagnose the first executed failure before adding or replacing checks.

## Documentation can be a checked product input

Download-channel changes can invalidate release tests even when executable code is unchanged. Run the owning documentation-contract tests when README download claims change. Path expectations must follow the host's path API; do not force POSIX output from a cross-platform function or weaken product behavior to satisfy a fixture.

- 核对所有语言 README 的实际内容后再调整共享断言，不以英中页面推断其余翻译仍旧。
- Windows 安装包 CI 必须从固定自有 Harness 源构建；shell 的原生依赖探针与 own runtime 启动证据分别保留。

- 跨平台生成产物的source region可能保留OS路径分隔符；匹配时仅规范来源路径，写回保留目标原文，不改变业务上下文或模糊匹配阈值。

- 依赖补丁须用目标平台同实现工具回归。GNU patch 对不平衡上下文施加文件首尾约束，BSD可能接受；优先补全真实上下文，不降低fuzz或臆测依赖版本漂移。

- Windows上需要Git附带的单个工具时传绝对可执行路径，不能把整个usr/bin前置PATH；GNU tar等会改变C:路径语义。外部测试子进程必须有明确超时。
