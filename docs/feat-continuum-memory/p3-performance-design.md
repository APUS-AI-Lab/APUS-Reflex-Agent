# P3 performance and quality evidence design

English | [中文](p3-performance-design.zh.md)

## Goal

Generate reviewable metrics from the same protected A0/A1/B/C/U real-model requests: applicable assertion rate, candidate agreement between Jev active and the deterministic baseline, request P50/P95 latency, and input/output token totals. The evaluator writes JSON evidence first; a pure report function computes the metrics so numbers are not copied by hand.

## Measurement rules

Latency is wall-clock time from the start of each variant/task to the completed DeepSeek response. P50 and P95 use nearest-rank, with sample counts and request counts per variant. Tokens come only from provider usage fields. Cost for Jev, indexing, Session writes, and local CPU is unknown when the provider does not report it; it is never filled with zero. The baseline is a candidate-selection comparison and does not claim to have completed the model task again.

## Acceptance conditions

Real evidence must contain 20 unique cells, 11 applicable passes, zero failures, and `end_turn` for every response. The report rejects missing fields, duplicate cells, empty latency, and negative token counts. Local stable-prefix bytes are never reported as provider cache hits.
