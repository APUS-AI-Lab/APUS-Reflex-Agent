# System3 服务器部署参考

[English](deployment.md) | 中文

## 范围

独立的 `xdan-system3.service` 运行在 `root@litellm`。Docker 构建 Linux 源码和依赖；应用以专用系统用户 `xdan-system3` 运行。现有 LiteLLM、Caddy 和 Owlume 容器保持独立。运行时通过 `deploy/system3/runtime.patch.yml` 启动受支持的 `dsh web` profile。发布目录归 root 所有，服务用户不能修改；`/opt/xdan-system3/current` 选择当前发布。

## 访问和隔离

应用仅监听 `127.0.0.1:18731`。通过 `ssh -N -L 18731:127.0.0.1:18731 root@litellm` 连接，并从受限服务日志中私下获取原生启动 URL。浏览器用启动 token 换取原生签名、绑定访问来源的 cookie；匿名 API 请求仍被拒绝。SSH 验证传输访问，Harness cookie 验证 API 访问。无需新增公网 Caddy 路由或修改 DNS。

本机已安装 `~/Applications/xDAN System3.app`；双击 `~/Applications/启动 xDAN System3.command` 或运行 `~/.local/bin/xdan-system3` 启动 Desktop。Web 首次认证入口保存在权限为 0600 的 `~/.config/xdan-system3/launch-url`，由本机浏览器打开；不要在聊天或共享日志中打印该文件。已认证浏览器可访问 `http://127.0.0.1:18731`；未认证访问返回 401。

SSH 隧道不属于 systemd 服务。当前隧道在网络断开后可能退出；仅在本机 18731 没有监听时，使用以下命令恢复，保留已有隧道和服务进程。

```sh
ssh -fN -o BatchMode=yes -o ConnectTimeout=10 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18731:127.0.0.1:18731 root@litellm
```

systemd 单元采用空 capability 集、NoNewPrivileges、ProtectSystem=strict、ProtectHome、PrivateTmp、PrivateDevices、ProtectProc=invisible 和 RestrictSUIDSGID。仅 `/var/lib/xdan-system3` 可写；私有 home 和任务工作区分离。服务内部不能访问现有应用目录和环境变量文件目录。服务限制为 2 GiB 内存、2 CPU 配额和 256 个任务。保留原生 workspace-write 权限；子进程使用原生凭据清理和 bubblewrap。

仅 root 可读的 `/etc/xdan-system3/runtime.env` 复用既有 `system3-dsh` virtual key，提供 `SYSTEM3_LITELLM_API_KEY`、`JEV_API_KEY` 和显式 JSON `SYSTEM3_SESSION_DATA_CLASSES`。验收环境仅声明公开材料；操作人员不得将个人或机密文件放入该工作区。分类是部署声明，不是自动脱敏。凭据不进入构建产物或前端 bundle。原生浏览器凭据持久保存在私有 Harness home。禁用 DeepSeek 会话日志贡献和遥测投递。

## 发布和恢复

在服务器的已审查源码归档目录运行 `deploy/system3/release.sh <immutable-release-id> <source-commit>`。脚本依据 lockfile 安装依赖，在固定 Node 镜像中构建 Linux 产物，提取应用及匹配的 Node/bubblewrap 二进制，建立归 root 所有的发布目录，原子切换后仅重启 System3 单元。源码 commit 写入客户端元数据和镜像标签。健康检查要求进程 active，且匿名 API 请求返回 HTTP 401。 只有健康发布才更新前一发布指针；发布失败保留已有回滚目标。每个发布保存自己的 `service.unit`；旧的活动发布在首次被替代前补存当时的单元一次。

`deploy/system3/rollback.sh` 选择兼容的前一版本及其保存的单元，并保留会话。回滚成功后消费目标指针；重复执行直接失败，不重启或修改单元。回滚失败则恢复原版本及其单元，并保留目标。应用回滚不会撤销会话格式或数据库迁移；涉及持久格式变更的发布须先停服务备份。`Restart=on-failure` 和启用的 systemd 单元支持进程故障或主机重启后恢复。可用性检查不等同任务验收：还需单独验证浏览器鉴权、真实 Jev 选择、Fidoo 输出、Skill 采用、原生 shell 执行、产物正确性、取消和重启后的持久化。

## 源码文件

| 文件 | 用途 |
| --- | --- |
| `deploy/system3/Dockerfile` | 固定 Linux 构建与源码元数据 |
| `deploy/system3/Dockerfile.dockerignore` | 排除本地依赖、构建输出和常见凭据文件 |
| `deploy/system3/runtime.patch.yml` | Loopback 传输、模型路由和显式 System3 策略 |
| `deploy/system3/xdan-system3.service` | 专用用户、文件系统隔离和资源限制 |
| `deploy/system3/release.sh` | 构建、提取、切换和健康验证 |
| `deploy/system3/rollback.sh` | 恢复兼容的前一发布 |
| `deploy/system3/tests/release.spec.sh` | 发布和回滚的隔离故障注入 |

## 已验证的部署约束

目标运行 TencentOS x86_64、内核 6.6.117、glibc 2.38、systemd 255 和 Docker 29.8.1。固定 Node 镜像运行 24.21.0。System3 专属 key 成功列出两个配置的 Fidoo 模型；A100 Jev 健康端点报告 ready/high32。基线 rc.2 Linux 构建通过 native 编译、Host 和 Client TypeScript/bundling、desktop bundle 与 Web 构建（343 个客户端产物）。

内核没有启用 Landlock LSM。采用默认 Docker seccomp 的非 root 容器无法创建 bubblewrap namespace；临时诊断容器取消该过滤后仍无法挂载私有 proc 文件系统。因此部署使用原生 systemd，未放宽容器权限。宿主以及选定 systemd 加固下的 bubblewrap 均可写工作区，并以只读文件系统错误拒绝写入同一用户的 home。原生环境清理也通过子进程检查，两项部署凭据仅存在于父进程。八种隔离发布脚本场景通过：发布/手动回滚、激活失败、HTTP/鉴权健康失败、提取失败、非法发布标识、第三次发布失败保留更早回滚目标、重复回滚不修改服务，以及回滚失败恢复原版本和单元配对。初次浏览器任务证据见 `deployment-preflight.json`。已审查标签 `system3-g1-reviewed-rc2` 从验收发布成功回滚到同一提交的稳定发布，稳定发布保持运行，回滚目标已消费。两次 Linux 构建和发布健康检查通过；实际 CLI 在 Node 24.21.0 上报告 `0.1.7-rc.2`。匿名 API 返回 401，不可信 Origin/Host 返回 403，启用的非 root 服务仅监听 loopback。基础设施证据及准确源码提交见 [deployment-final.json](deployment-final.json)；真实浏览器任务、凭据清理、取消、模型重置、严格产物 oracle，以及重启和回滚后的同会话浏览器回放均已通过。首次产物多出一个字段，经原生继续执行移除后才通过最终 oracle。真实入口决策因低置信度放弃选择并使用配置基线；Skill 决策将选中的指令注入实际 Fidoo 请求。
