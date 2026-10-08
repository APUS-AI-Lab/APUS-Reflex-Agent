# System3 浏览器验收

[English](README.md) | 中文

`accept.py` 按用户使用的方式检查 System3 部署：通过 gstack browse 在公网站点上输入，然后检查用户看到的内容（dock 文案、终端卡片）和 Session 日志记录的事实。每次发布后运行；场景的所有检查都通过才算通过。

```sh
python3 deploy/system3/acceptance/accept.py                 # all scenarios
python3 deploy/system3/acceptance/accept.py goal-interrupt  # one scenario
```

| 场景 | 用户做什么 | 必须成立 |
|---|---|---|
| `routing` | 先请求翻译，再问一道推理题 | 有两次入口决策；翻译由 `deepseek-flash` 回答，推理题由更强的模型回答 |
| `folding` | 询问一次五个用例同样失败的 unittest 为什么失败 | 应用了 `system3/output-fold`；终端卡片的标记引用被重复段的第一行；回答指出共同原因 |
| `task-frame` | 提出任务、补充要求、继续，然后换话题 | dock 显示记下 1 条要求；模型收到了任务卡；换话题后任务卡离开 dock，开始新的任务卡 |
| `goal-interrupt` | 开始一个 `/goal`，然后打断正在运行的这一轮 | dock 提示要求已插入正在运行的这一轮；模型读到打断后先改名、再跑测试；目标完成；工作区里有 `check_ledger.py` |
| `codex-forward` | 把任务交给 Codex，在 Codex 运行时补充一条要求 | Codex 卡片列出转发的文本；`system3/interjection` 记录 `forwardedTo: codex`；Codex 产出 `check_ledger.py` |

`goal-interrupt` 遇到问题卡时选择第一个选项，即推荐项。会写文件的场景使用服务工作区下的 `goal-check` 或 `fold-check`，结束后删除。

## 前置条件

- 部署主机的 SSH 别名（`SYSTEM3_HOST`，默认 `prd`）；脚本读取 Session 日志，浏览器未登录时还会从服务日志读取最新的启动令牌。启动链接写入 `~/.config/xdan-system3/public-launch-url`，权限 600，从不打印。
- gstack browse 可执行文件（`BROWSE`，默认 `~/.claude/skills/gstack/browse/dist/browse`）。
- `SYSTEM3_SITE` 覆盖站点地址；`ACCEPT_OUT` 指定截图和浏览器状态的目录。

模型的回答每次不同，所以检查断言的是部署保证的事实（事件、文件、dock 文案），而不是具体措辞。
