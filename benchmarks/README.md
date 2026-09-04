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

Compare the relation-aware graph, lexical, local-encoder, and learned-ranker
tracks without a provider request:

```sh
npm run benchmark:compare:action-compilation-retrieval-v3 -- \
  --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 \
  --output benchmarks/action-compilation/fullcatalog-stabilized/evaluations/retrieval-graph-ab-v3 \
  --model multilingual-e5-small
```

The v3 comparison uses a per-slot 20% budget and requires micro/macro recall
at least 90%, average and p95 compression above 80%, zero invalid/private
outputs, and deterministic results. The local `multilingual-e5-small` model
must already exist under `.livingworld-benchmarks/models/`; evaluation disables
remote model loading and fails closed when the asset is missing. Use
`--deterministic-only` to run the non-encoder tracks without a model asset.

If no formal algorithm passes all gates, the comparison also records a
diagnostic run for the best observed non-control algorithm at 25% and 30%
budgets. These runs are explicitly non-recommendable and never relax the 20%
production-oriented gate; they only indicate whether the shortlist budget is
the limiting factor.

Reports include per-case recall, missing-key kind/use strata, and the union
recall of slot shortlists for each physical batch. Invalid or slot-private
keys are reported separately and never count as recalled keys.

The v3 evaluator does not modify the frozen v1 benchmark schema or enable a
retriever in production. Its result directory is an experiment artifact; a
future production promotion requires a separately versioned algorithm
manifest and replay/semantic-validation decision. The current 46-case
dataset may produce an exploratory ranker only; promotion requires at least
200 accepted cases from three independent world/catalog snapshots.

To capture the complete pre-shortlist context and immutable state evidence from
a running Ledger (read-only, zero provider requests), use:

```sh
npm run benchmark:capture:action-compilation -- \
  --database .livingworld-v20/livingworld.sqlite \
  --execution <execution-id> \
  --output .livingworld-benchmarks/source/action-compilation
```

Captured sources can be regenerated into a new benchmark version only by an
explicit provider adapter. This is the sole path that may call a live
FullCatalog model; offline retrieval evaluation never does:

```sh
npm run benchmark:regenerate:action-compilation-reference -- \
  --source .livingworld-benchmarks/source/action-compilation \
  --output benchmarks/action-compilation/fullcatalog-stabilized \
  --version 2 \
  --provider-module ./scripts/your-fullcatalog-adapter.ts
```

For a single command, `benchmark:refresh:action-compilation-reference` runs
the read-only capture followed by this explicit versioned regeneration.

The exporter opens the Ledger read-only and makes no provider or network request. Use `--instance <instance-id>` to collect every Action Compilation execution in an instance. Frozen versions are never overwritten; export additional source executions into the next version.

The exported manifest records source execution IDs and the observed provider,
transport, logical invocation, and repair counts separately from the zero
provider requests performed by the exporter. Source world, catalog, registry,
algorithm, prompt, candidate-key, and repair fingerprints must match when
multiple executions are combined.
