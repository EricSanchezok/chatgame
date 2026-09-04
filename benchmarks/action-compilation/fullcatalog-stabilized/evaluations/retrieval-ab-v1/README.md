# Action Compilation Candidate Retrieval Offline Comparison v1

This directory records the deterministic, zero-LLM comparison for the frozen
`action-compilation/fullcatalog-stabilized` v1 benchmark. It evaluates the
retrievers defined in `src/engine/benchmarks/action-compilation/retrievers/`
against the final accepted `requiredCandidateKeys` in each benchmark case.

## Reproduce

```sh
npm run benchmark:compare:action-compilation-reference -- \
  --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 \
  --output benchmarks/action-compilation/fullcatalog-stabilized/evaluations/retrieval-ab-v1 \
  --force
```

The command reads only local gzip benchmark shards. It does not import the
model gateway, make network requests, or mutate world state. The output is an
evaluation artifact, not a change to the frozen benchmark schema or cases.

`results.json` contains the comparison matrix, hard-gate status, Pareto front,
and recommendation. Individual evaluator reports are in `reports/`.
