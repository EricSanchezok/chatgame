# Local benchmark datasets

This directory contains versioned, source-controlled benchmark artifacts for Living World Engine. The benchmark owner is 上海创智学院 and the project is Living World Engine.

`registry.json` is the index. A benchmark version is immutable once marked `frozen`; changes to the world snapshot, model/profile, prompt, Action Compilation projector, candidate-key format, repair policy, or dataset schema require a new version. Exported data is written to a staging directory and published only after shard hashes and semantic contracts pass verification.

The first benchmark family, `action-compilation/fullcatalog-stabilized`, measures whether a candidate retriever recalls the final candidate keys selected by the production C3 FullCatalog path. These targets are a stabilized behavioral reference, not absolute semantic ground truth. The FullCatalog baseline is expected to have recall 1.0 by construction.

Export a version from recorded Action Compilation evidence with:

```sh
npm run benchmark:export:action-compilation-reference -- \
  --database .livingworld-v20/livingworld.sqlite \
  --execution <execution-id> \
  --version 1
```

Evaluate a retriever offline (the module must export a `CandidateRetriever` function or a default function):

```sh
npm run benchmark:evaluate:action-compilation-reference -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 --retriever ./path/to/retriever.ts
```

Verify a frozen dataset and its FullCatalog control:

```sh
npm run benchmark:verify:action-compilation-reference
```

The exporter opens the Ledger read-only and makes no provider or network request. Use `--instance <instance-id>` to collect every Action Compilation execution in an instance. Frozen versions are never overwritten; export additional source executions into the next version.

The exported manifest records source execution IDs and the observed provider,
transport, logical invocation, and repair counts separately from the zero
provider requests performed by the exporter. Source world, catalog, registry,
algorithm, prompt, candidate-key, and repair fingerprints must match when
multiple executions are combined.
