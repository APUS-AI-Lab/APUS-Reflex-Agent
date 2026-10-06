---
name: csv-reconciliation
description: Reconcile CSV orders by region, excluding refunded orders, and produce an independently checkable JSON artifact.
---

# CSV reconciliation

Read the complete CSV before calculating. Treat `amount` as a decimal currency value, include only rows whose status is `paid`, and group by `region`. Do not change the source CSV.

Write `artifacts/region-totals.json` with `currency: "USD"`, `paidOrders`, `excludedOrders`, `byRegion` and `total`. Store monetary values as fixed two-decimal strings. Run a separate check that the sum of regional totals equals `total` and that the paid and excluded counts cover all input rows. Report the artifact path and the actual verification result. A failed command or missing artifact must be reported as an incomplete task.
