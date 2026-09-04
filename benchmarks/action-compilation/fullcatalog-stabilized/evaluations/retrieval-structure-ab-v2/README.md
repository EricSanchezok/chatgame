# Action Compilation retrieval structure/encoder A/B v2

This directory is reserved for the offline evaluation output produced against
the frozen `fullcatalog-stabilized/v1` benchmark. The evaluator writes
`results.json` and one report per algorithm under `reports/`; it never changes
the benchmark context or case shards.

The formal comparison uses a per-slot 20% visible-catalog budget. A candidate
retriever is recommendable only when it reaches at least 90% micro and macro
recall, strictly more than 80% average compression, a p95 shortlist ratio
strictly below 0.20, zero invalid/private keys, and deterministic output.
There is no FullCatalog fallback. If all formal algorithms fail, the evaluator
may record 25% and 30% diagnostic budgets; those diagnostics cannot become the
recommendation.

The encoder track requires a pre-existing local `intfloat/multilingual-e5-small`
asset. Remote model loading and network access are disabled. This artifact is
behavioral agreement with FullCatalog, not a semantic ground-truth claim, and
does not enable any retriever in production.
