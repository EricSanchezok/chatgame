# Action Compilation retrieval graph/encoder A/B v3

This evaluation references the immutable
`action-compilation/fullcatalog-stabilized/v1` dataset. It was run completely
offline with the local Transformers.js-compatible
`intfloat/multilingual-e5-small` asset and does not call an LLM, access the
network, or mutate world state.

Command:

```sh
npm run benchmark:compare:action-compilation-retrieval-v3 -- \
  --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 \
  --output benchmarks/action-compilation/fullcatalog-stabilized/evaluations/retrieval-graph-ab-v3 \
  --model multilingual-e5-small --bootstrap-samples 200
```

The encoder asset was installed from the pinned
`Xenova/multilingual-e5-small` revision
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`. The exact model-directory hash,
Transformers.js version/library hash, vector dimension, prefixes, pooling,
normalization, truncation, and batch size are recorded in `results.json`.

## Result

No non-control algorithm passed all v3 hard gates, so the recorded
recommendation is `retain-fullcatalog`:

| Track | Micro recall | Macro recall | Average compression | P95 shortlist ratio |
|---|---:|---:|---:|---:|
| A0 FullCatalog | 100.00% | 100.00% | 0.00% | 1.0000 |
| D1 anchor + lexical | 80.30% | 84.48% | 80.03% | 0.2000 |
| G1/G2/G3 graph | 81.28% | 82.88% | 80.04% | 0.1998 |
| E1 encoder | 79.80% | 82.05% | 80.04% | 0.1998 |
| H1 graph + encoder | 79.80% | 82.05% | 80.04% | 0.1998 |
| H2 coverage hybrid | 79.64% | 81.94% | 80.04% | 0.1998 |

The 25% and 30% runs are diagnostic only and remain below the formal
compression gate. L1/L2 are not evaluated because the current 46-case dataset
does not satisfy the independent-snapshot training gate; no learned ranker is
promoted.

The JSON reports retain per-case missing keys, kind/use strata, relation-path
diagnostics, deterministic bootstrap intervals, invalid/private-key counts, and
budget violations. This is a behavioral comparison against FullCatalog, not a
semantic ground-truth claim.
