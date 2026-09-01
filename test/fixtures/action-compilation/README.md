# Action Compilation experiment fixtures

This directory contains the reviewable inputs and immutable evidence for the Action Compilation context experiment defined by [Spec 0014](../../../docs/specs/0014-action-compilation-context-and-temporal-eligibility.md).

- `corpus.jsonl` contains 48 human-reviewable actions: six cases in each of eight temporal and reference-boundary categories. It contains no endpoint, credential, raw provider request, or hidden Agent cognition.
- `gold.json` records exact temporal evidence, eligible/excluded Profile expectations, required candidate anchors, legal reference uses, and global/expansion expectations. Category defaults are inherited by each record; record-level fields own the remaining expectations.
- `baseline/metrics.json` is the unchanged C0 Ledger measurement.
- `offline-report.json` is the immutable Layer A/B result for the historical C0-C5 and E0/E1 comparison. The comparison implementations have been removed after promotion; the report remains the reproducibility evidence.
- `live-corpus.jsonl` binds 12 actions to authored Blackmarsh Agents and explicit acceptable temporal profiles.
- `live-report.json` is the checked-in 12-batch × 3-repetition paired DeepSeek V4 Flash result. Each transport retry remains a separate Ledger execution; selection requires C3 to have no failed final cells, preserve or improve commit/profile accuracy, and reduce per-slot input-token p95.

Verify the promoted result and reports:

```sh
npm run benchmark:action-compilation
```

To generate a fresh Ledger-derived execution report for investigation, call `scripts/experiments/action-compilation-evaluation.ts` directly with an explicit database and execution; do not reintroduce runtime context variants or selection flags.
