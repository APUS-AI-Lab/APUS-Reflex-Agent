# 桌面 System3 设置

[English](README.md) | 中文

本插件提供 **设置 → System3**，默认关闭。普通配置通过 Harness settings 保存，API Key 通过现有 credentials 服务保存。先在 **设置 → 模型** 配置生成模型，再把其 Provider ID 和模型 ID 填入候选模型。

启用需要 HTTP(S) Jev 地址、决策模型、至少一个 ID 唯一的候选模型、明确的数据类别，并授权发送到 Jev、候选模型提供商和对话当前模型提供商。候选 ID 不得使用保留的 `baseline` 选路名。无需认证的服务可以清空凭证引用名。地址不接受用户信息、查询参数或 fragment，不附带生产端点或共享密钥。

配置以单个 `settings` 对象持久化到 Profile overlay；`volatile` 表示不重启设置插件即可实时更新。实时修改会串行替换子服务；关闭和卸载均销毁 Jev、System3 子 fiber。保存使用原生 revision 防止覆盖并发修改。更换密钥必须使用新的专用凭证引用名，页面不覆盖运行中服务可能正在使用的已有引用。密钥先于配置写入，若随后发生配置冲突，密钥可能已经保存，页面会明确说明。保存失败会保留草稿；重载操作明确丢弃草稿并载入最新已保存配置。页面展示关闭、启动中、就绪或失败的本地服务状态，并提供刷新操作。就绪不代表网络连接可用；请在新对话发送简单任务，并查看记录的 System3 选路结果。

运行时必须提供 `@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin` 和 `@deepseek-ai/dsh-experimental-system3`。两个 peer 标记 optional 仅用于避免从公开 npm 拉取实验包，实际启用时仍必须存在。桌面 patch 同时加载已有 System3 事件卡片。
