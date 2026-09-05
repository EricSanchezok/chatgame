# Local benchmark datasets

This directory contains versioned, source-controlled benchmark artifacts for Living World Engine. The benchmark owner is 上海创智学院 and the project is Living World Engine.

The storage boundary is intentional:

```text
benchmarks/                                      # Git-tracked, reviewable artifacts
  registry.json                                  # dataset family/version index
  action-compilation/fullcatalog-stabilized/
    v1/                                          # frozen behavioral reference
    evaluations/<experiment-id>/                 # offline reports; never rewrite v1
.livingworld-benchmarks/                         # local-only, Git-ignored material
  models/                                        # exploratory ranker/training assets
  source/                                        # raw Ledger captures for regeneration
.livingworld-cache/                              # local-only, Git-ignored runtime cache
  models/multilingual-e5-small/<asset-hash>/     # pinned local Encoder asset
  embeddings/action-compilation/                 # persistent passage vectors
```

Only frozen benchmark shards, manifests, READMEs, and evaluation reports belong
under `benchmarks/`. Provider requests, state snapshots used for regeneration,
source state snapshots and training checkpoints stay under the ignored
`.livingworld-benchmarks/` directory. Encoder assets and derived embeddings
stay under `.livingworld-cache/`. Neither local tree may contain credentials.

`registry.json` is the index. A benchmark version is immutable once marked `frozen`; changes to the world snapshot, model/profile, prompt, Action Compilation projector, candidate-key format, repair policy, or dataset schema require a new version. Exported data is written to a staging directory and published only after shard hashes and semantic contracts pass verification.

The first benchmark family, `action-compilation/fullcatalog-stabilized`, measures whether a candidate retriever recalls the final candidate keys selected by the production C3 FullCatalog path. These targets are a stabilized behavioral reference, not absolute semantic ground truth. The FullCatalog baseline is expected to have recall 1.0 by construction.

Export a version from recorded Action Compilation evidence with:

```sh
npm run benchmark:export:action-compilation-reference -- \
  --database .livingworld-v22/livingworld.sqlite \
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
must already exist under `.livingworld-cache/models/`; evaluation disables
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

Run the production-shaped v4 comparison after warming the persistent cache:

```sh
npm run retrieval:cache:warm -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1
npm run retrieval:cache:verify -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1
npm run benchmark:compare:action-compilation-retrieval-v4 -- --force
```

The v4 evaluator calls the same asynchronous retriever owned by `eager-reference`, applies one strict budget to each physical batch, and reports per-slot membership plus persistent-cache evidence. It remains offline: zero LLM requests, zero network requests, and zero world mutations. Its result is an activation input, not permission to enable a treatment; an experiment also needs successful replay evidence and every activation gate.

## Installing and checking the local encoder

The encoder track uses the Transformers.js-compatible ONNX export of
`intfloat/multilingual-e5-small`. Install the pinned asset once into its
content-addressed cache directory (the download can be resumed if the ONNX file is large):

```sh
mkdir -p .livingworld-cache/models/multilingual-e5-small/d36818af59d24cf4293a78d41f2194a215157aefcfccb4c650902c851a0a0b2c
hf download Xenova/multilingual-e5-small \
  --revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78 \
  --include config.json tokenizer.json tokenizer_config.json special_tokens_map.json onnx/model.onnx \
  --local-dir .livingworld-cache/models/multilingual-e5-small/d36818af59d24cf4293a78d41f2194a215157aefcfccb4c650902c851a0a0b2c
```

`Xenova/multilingual-e5-small` is the local ONNX packaging; experiment
manifests still record the semantic model ID as
`intfloat/multilingual-e5-small`. Do not place model files in Git. The loader
records the asset-directory SHA-256 plus the exact Transformers.js and
`onnxruntime-node` package hashes, embedding dimension,
prefixes, pooling, normalization, fixed 128-token truncation, and 128-item
inference batches in `results.json`. Mutable downloader
metadata under `.cache/` is excluded from the model hash. A valid install must
load locally and produce 384-dimensional vectors:

```sh
npx tsx -e 'import {discoverLocalEncoderModelDirectory,loadLocalMultilingualE5Small} from "./src/engine/algorithms/eager-reference/candidate-retrieval/local-encoder"; (async()=>{const e=await loadLocalMultilingualE5Small({modelDirectory:discoverLocalEncoderModelDirectory()}); const v=await e.encodeBatch(["query: smoke-test"]); console.log({modelId:e.modelId,dimensions:e.dimensions,rows:v.length,vectorLength:v[0]?.length,modelHash:e.modelHash})})()'
```

If the directory is absent or corrupt, E1/H1/H2 and learned tracks are
reported as `blocked`; evaluation never downloads a model, uses an online
embedding service, or silently substitutes another model.

Candidate passage embeddings are not recomputed on each evaluation or server restart. `retrieval:cache:warm` writes only missing exact passages, `retrieval:cache:verify` opens the selected SQLite read-only and validates every checksum, and `retrieval:cache:status` lists cache partitions without loading the Encoder. The dynamic slot query is still encoded per call and held only in a bounded process-local LRU.

To capture the complete pre-shortlist context and immutable state evidence from
a running Ledger (read-only, zero provider requests), use:

```sh
npm run benchmark:capture:action-compilation -- \
  --database .livingworld-v22/livingworld.sqlite \
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

## Maintenance rules

- Treat every `vN` directory as immutable after `status: frozen`; a new world,
  catalog, prompt, projector, candidate-key version, repair policy, or model
  creates `vN+1` rather than changing historical files.
- Keep evaluation output in a named directory such as
  `evaluations/retrieval-graph-ab-v3/`; it references a dataset version and is
  safe to replace only for local scratch output with an explicit force flag.
- Capture current executions with the read-only Ledger command before asking for
  regeneration. Regeneration is the only command that may call a provider, and
  it requires an explicit adapter plus an exact pre-step state snapshot.
- Run `benchmark:verify:action-compilation-reference` after copying or
  archiving shards. Run `check:fast` after code or schema changes.
- Keep Encoder and reranker assets local and record their hashes in experiment
  manifests. Never commit `.livingworld-cache/`, `.livingworld-benchmarks/`,
  provider headers, cookies, API keys, or partial benchmark output.
