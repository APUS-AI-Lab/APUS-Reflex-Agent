# P2 index and backlog design

## Goal

Provide an optional deterministic inverted index for Continuum retrieval that can be rebuilt from the current `MemoryRecordStore` projection and can expose queued records while a bounded rebuild is in progress. The existing linear retrieval path remains the default, so profiles without an index preserve current behavior.

## API

- `MemoryRecordIndex.rebuild(records)` replaces the index atomically and clears backlog.
- `MemoryRecordIndex.enqueue(record)` records a changed snapshot as pending work.
- `MemoryRecordIndex.rebuildPending(limit)` applies at most `limit` queued records and reports remaining backlog.
- `MemoryRecordIndex.idsForTerms(terms)` returns a deterministic union of posting lists.
- `retrieveMemoryWorkingSet` accepts optional `index`; it narrows scoring candidates using the index but still reads the authoritative store snapshot and filters active records, so stale or retired postings cannot disclose memory.

## Invariants

1. The record store and Session event log remain the source of truth; the index is disposable derived state.
2. Rebuild is deterministic for identical records and does not mutate records.
3. Pending work is visible through `pendingCount`; bounded rebuild makes backlog progress explicit.
4. Missing or stale postings only reduce the optimization set; callers can omit the index or rebuild it.
5. Candidate and byte limits, ordering, supersede/deactivate semantics, and scope authorization are unchanged.

## Validation

Unit tests cover deterministic postings, bounded backlog rebuild, full rebuild equivalence, stale retired records, and retrieval equivalence with and without an index. Run the Continuum package tests, host build, and lint.
