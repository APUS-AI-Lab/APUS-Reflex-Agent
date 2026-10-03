---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-system3-route-health

[English](2026-10-04-system3-route-health.md) | 中文

## 概述

为 system3/entry-decision 新增可选的 avoided 字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-system3-route-health
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-10-03-system3-entry-explicit-delegation"
    after: "9c7cecd646b7d0ce7f1fbf3b341f2d1c1c31135d0de9e1cb556a51a0d33177ff"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有决策记录仍然有效，不含该字段。只有配置了 entryRouting.routeHealth，且至少一个模型候选线路降级、同时仍有其他候选时，System3 才写入 avoided；每一项记录候选 id、已配置时的标签，以及原因（errors、slow-first-token 或 slow-output）。avoided 中的候选不出现在 candidateIds 和 Jev 请求里。忽略该字段的读取方看到的是一次在剩余候选中做出的普通决策。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/route-health.spec.ts：7 个测试通过，覆盖首字延迟、生成速度和错误率导致的降级，样本窗口与过期，空闲探测，降级候选不进入 Jev 请求并记录原因，委派从不被避开，以及所有候选都会被避开时不做排除。

<a id="dev-note"></a>
## 开发备注

无。
