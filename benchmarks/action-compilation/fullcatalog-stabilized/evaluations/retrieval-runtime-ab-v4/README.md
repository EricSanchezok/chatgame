# Action Compilation runtime retrieval evaluation v4

This directory records the production-shaped offline comparison against frozen `fullcatalog-stabilized/v1`. The evaluator invokes the same asynchronous graph/Encoder retriever owned by `eager-reference`, uses one strict budget for each physical batch, preserves independent per-slot membership, and reads prewarmed passage vectors from the content-addressed cache.

Run:

```sh
npm run retrieval:cache:verify -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1
npm run benchmark:compare:action-compilation-retrieval-v4 -- --force
```

The evaluation performs zero LLM requests, zero network requests, and zero world mutations. `results.json` pins the frozen dataset, local Encoder, runtime, cache, physical-batch compression, recall, invalid/private/out-of-shortlist counts, and deterministic repetition evidence.

An artifact qualifies a treatment only when micro and macro recall are at least 90%, average physical-batch compression is above 80%, p95 batch shortlist ratio is below 0.20, every safety count is zero, cache readiness is 100%, and an independent replay proves state, causal, RNG, and commit equivalence. The recorded H2 runtime does not meet recall and therefore recommends FullCatalog.
