# Action Compilation experiment fixtures

This directory contains the reviewable inputs and immutable evidence for the Action Compilation context experiment defined by [Spec 0014](../../../docs/specs/0014-action-compilation-context-and-temporal-eligibility.md).

- `corpus.jsonl` contains 48 human-reviewable actions: six cases in each of eight temporal and reference-boundary categories. It contains no endpoint, credential, raw provider request, or hidden Agent cognition.
- `gold.json` records exact temporal evidence, eligible/excluded Profile expectations, required candidate anchors, legal reference uses, and global/expansion expectations. Category defaults are inherited by each record; record-level fields own the remaining expectations.
- `baseline/metrics.json` is the unchanged C0 Ledger measurement.
- `offline-report.json` is the checked-in Layer A/B result for C0-C5 and E0/E1. Projector wall times are descriptive machine-local observations; correctness gates use exact namespace, evidence, detail-recall, and byte measurements.
- `live-corpus.jsonl` binds 12 actions to authored Blackmarsh Agents and explicit acceptable temporal profiles.
- `live-report.json` is the checked-in 12-batch × 3-repetition paired DeepSeek V4 Flash result. Each transport retry remains a separate Ledger execution; selection requires C3 to have no failed final cells, preserve or improve commit/profile accuracy, and reduce per-slot input-token p95.

Recompute the report from the preserved baseline Ledger:

```sh
npm run experiment:action-compilation -- --out test/fixtures/action-compilation/offline-report.json
npm run experiment:action-compilation:live -- --batches 12 --repetitions 3 --out test/fixtures/action-compilation/live-report.json
```

The benchmark projectors are selection-time implementations only. Production code must contain only the promoted winner after WP7.
