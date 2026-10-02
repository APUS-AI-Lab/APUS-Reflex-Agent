# 委派门槛校准用例

[English](README.md) | 中文

这些用例用于校准委派门槛：每道任务都是按规模分级（极小、小、中、大）的真实 Python 编码请求，配有隐藏验收测试，因此同一道任务可以分别交给各对照组（快速模型直接用 shell 和文件工具完成，或委派给 Codex agent），再比较通过率和耗时。

## 目录结构

每个 `tasks/<id>/` 目录包含 `meta.json`（`id`、`size`、中文用户 `prompt`，以及说明规模的英文 `note`）、`workspace/`（agent 修改的初始项目；Python 3.12 标准库加 pytest）、`hidden/test_hidden.py`（agent 看不到的验收测试）和 `reference/`（按相同相对路径覆盖到 `workspace/` 上即构成正确答案的文件）。

隐藏测试以工作区副本作为当前目录、pytest rootdir 和 `PYTHONPATH` 运行：`cd <workspace-copy> && PYTHONPATH=. python3 -m pytest -q -p no:cacheprovider --rootdir . <path>/test_hidden.py`。agent 完成后该命令退出码为 0，即该组通过此任务；提示词提到时，`workspace/tests/` 下的可见测试也属于任务的一部分。

agent 只拿到 `meta.json` 的 `prompt` 和一份 `workspace/` 副本。绝不能把 `hidden/` 或 `reference/` 暴露给被测 agent。

## 自检

在本目录运行 `python3 verify.py`（也可以传入任务 id 只检查一部分）。它对每道任务校验 `meta.json`，要求隐藏测试在未改动的工作区副本上失败，再覆盖 `reference/`，要求隐藏测试和可见测试都通过。它在临时目录里运行，关闭字节码和 pytest 缓存；用例目录中出现任何 `__pycache__`、`.pytest_cache` 或 `.ruff_cache` 目录时报错。

## 运行对照组

`probes/*.json` 是只测决策的仓库级提示词，由 `delegation-calibration-decisions.e2e.ts` 与任务一起路由。`run_arms.py` 以每组一个补丁（`<arm>.patch.yml`）、独立 home 和全新工作区副本，通过 `dsh headless` 回答每道任务，每次运行追加一条记录，包含耗时、主模型 token、工具调用和隐藏测试结果。`summarize.py` 根据决策报告组合出 Jev 组并打印对比。结果见[校准报告](../../../../../../docs/system3-delegation-progress/delegation-calibration.zh.md)。
