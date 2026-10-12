# 从一个仓库开发 APUS

[English](development.md) | 中文

本教程使用同一个仓库准备桌面宿主和 Harness。如果只想使用客户端，请阅读[安装教程](installation.zh.md)。

## 前提条件

先安装 Git、Node.js 24 和 pnpm 11.7.0。Node.js 自带 npm，准备命令会用它安装桌面锁文件中的依赖。首次准备需要联网下载依赖和 Electron；平台可能还需要原生构建工具，详见 [Harness 开发指南](../development.zh.md)。

## 准备与启动

```sh
git clone https://github.com/APUS-AI-Lab/APUS-Reflex-Harness.git
cd APUS-Reflex-Harness
pnpm run setup
pnpm run start:desktop
```

在仓库根目录执行这些命令。准备命令会安装根目录与桌面依赖、构建 Harness，并使用同一份源码准备桌面运行时，不需要第二个仓库或手动指定后端目录。启动后，按[模型配置教程](configuration.zh.md)在应用中配置服务商。

使用 `pnpm run dev:desktop` 重新构建并启动桌面宿主。修改 Harness 源码后，重新运行 `pnpm run setup`，构建并刷新内置运行时。开发 Web 版使用 `pnpm run dev:web`。开发进程运行时保留终端，启动另一个使用相同 Profile 的实例前先停止当前进程。

开发版与安装版桌面应用使用不同的数据目录，但多个工作树仍可能共享开发 Profile。测试迁移、恢复或插件变更时，请使用临时数据。

## 代码归属

| 目录 | 职责 |
| --- | --- |
| `frontend/` | Electron 窗口、原生集成、运行时进程与桌面扩展 |
| `apps/web/` | Web 入口 |
| `packages/` | Harness 能力、API 与共享 UI |
| `deploy/` | 产品装配与部署配置 |
| `scripts/` | 根目录准备、构建与发行编排 |

桌面保留 npm 锁文件，Harness 保留 pnpm 锁文件，由根命令统一协调。遇到安装问题时，先定位原因，不要直接替换任一依赖锁。

运行时准备使用临时工作区副本根目录下仅声明运行依赖的清单进行部署，避免 pnpm 10 legacy hoisted 部署嵌套项目时错误解析可执行文件目录。根包仅收录 `package.json`，不包含开发脚本或开发依赖；原工作区清单和锁文件保持不变。

## 验证与排障

构建成功不足以证明应用可用。请确认界面打开，配置模型，在临时工作区完成小任务，然后重启检查配置是否保留。打包还需要独立的[发行验收](releases.zh.md)。

准备失败时，保留第一个失败命令和错误；检查 Node、pnpm 版本、网络及原生构建前提，再重新运行准备命令。通过 [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues) 提交脱敏后的问题。贡献检查与架构要求见 [Harness 开发指南](../development.zh.md)和[架构文档](../architecture.zh.md)。
