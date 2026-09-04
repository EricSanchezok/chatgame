# Local benchmark datasets

This directory contains versioned, source-controlled benchmark artifacts for Living World Engine. The benchmark owner is 上海创智学院 and the project is Living World Engine.

`registry.json` is the index. A benchmark version is immutable once marked `frozen`; changes to the world snapshot, model/profile, prompt, Action Compilation projector, candidate-key format, repair policy, or dataset schema require a new version. Generated data is written to a staging directory and published only after shard hashes and semantic contracts pass verification.

The first benchmark family, `action-compilation/fullcatalog-stabilized`, measures whether a candidate retriever recalls the final candidate keys selected by the production C3 FullCatalog path. These targets are a stabilized behavioral reference, not absolute semantic ground truth. The FullCatalog baseline is expected to have recall 1.0 by construction.

Generate the first version with:

```sh
npm run benchmark:generate:action-compilation-reference -- --live --target 480 --max-provider-requests 1000
```

Evaluate a retriever offline (the module must export a `CandidateRetriever` function or a default function):

```sh
npm run benchmark:evaluate:action-compilation-reference -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 --retriever ./path/to/retriever.ts
```

Verify a frozen dataset and its FullCatalog control:

```sh
npm run benchmark:verify:action-compilation-reference
```
