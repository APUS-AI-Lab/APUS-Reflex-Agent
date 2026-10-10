---
description: "APUS Continuum 的版本化、带来源记忆记录语义。"
kind: package-library
---

# @deepseek-ai/dsh-continuum

## 摘要

本包目前提供 APUS Continuum 最小的记录语义：带 Session 事件来源的不可变记忆记录、revision 校验、明确更正和停用。当前实现是内存投影，不注册产品插件，不写 Session 事件，不调用 Reflex，也不提供无 Reflex 的无限记忆模式。

## 使用方式

后续 Session-backed provider 会把相同操作写入现有 Session 日志，并在 flush 成功后才报告可恢复。本批故意不把内存投影当作重启后的持久记忆。

## Model Experience

None, as this library does not register model context; a later Continuum consumer will own any injected evidence.

#### KV Cache effect

This package has no model request and no cache effect.

## Known Limitations and Deferred Work

- 当前没有磁盘 provider、索引、召回、Reflex adapter、摘要树或缓存策略。

## Dev Note

本包随 P1.1 小批次推进；下一批复用 `Session.append` 和 `ctx.sessions.flush(session)`，不增加第二套持久化事实源。
