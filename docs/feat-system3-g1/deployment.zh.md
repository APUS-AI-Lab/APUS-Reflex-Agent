# APUS Reflex 部署参考

[English](deployment.md) | 中文

## 公开部署入口

现行设置、显式数据分类与凭据引用见[公共 provider 配置](../dev-continuum-reflex-integration/public-provider-configuration.zh.md)和 [System3 包指南](../../packages/experimental/system3/README.zh.md)。部署端点、域名、主机别名与私有启动 URL 应保存在操作者管理的配置中。

早期文档描述的是维护者的一次部署。原始操作说明、机器清单、凭据文件布局和历史测试观察已在仓库外私有归档并保存内容哈希；它们不是现行公开部署步骤，也不能证明新部署已通过验收。

## 源文件

| 文件 | 用途 |
| --- | --- |
| [runtime.patch.yml](../../deploy/system3/runtime.patch.yml) | Profile 组合与显式 provider 设置 |
| [systemd 服务](../../deploy/system3/xdan-system3.service) | 现有服务模板；文件名和服务标识保留为兼容名称 |
| [nginx 模板](../../deploy/system3/nginx/system3.xdan.work.conf) | 现有模板文件名；部署前需配置自己的域名 |
| [Codex 配置](../../deploy/system3/codex/config.toml) | 委派运行时配置 |
| [发布脚本](../../deploy/system3/release.sh) | 部署实现 |
| [回滚脚本](../../deploy/system3/rollback.sh) | 恢复实现 |
| [发布测试](../../deploy/system3/tests/release.spec.sh) | 发布与回滚回归覆盖 |

## 验收范围

历史[部署结果](deployment-final.json)和[预检结果](deployment-preflight.json)保留已记录的结论，并移除私有部署元数据；它们不认证当前可用性、模型质量、新版本或与较新 Session 持久数据的兼容性。实际部署需分别验证认证、provider 调用、任务产物、取消、持久化与恢复。
