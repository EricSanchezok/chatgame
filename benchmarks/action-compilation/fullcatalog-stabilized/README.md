# FullCatalog C3 stabilized behavior

Versioned artifacts are exported under `v1/` from recorded game executions. The exporter reads the production Action Compilation C3 evidence and stores only slots that the production compiler accepted after its existing semantic repair path.

Each accepted slot case references one deduplicated full C3 context using `contextHash` and `slotIndex`. `requiredCandidateKeys` contains the final resolved candidate keys, sorted and deduplicated. It is a behavioral reference to the stable production path, not a claim that the model's selection is semantically perfect.

Export a version with:

```sh
npm run benchmark:export:action-compilation-reference -- --database .livingworld-v20/livingworld.sqlite --execution <execution-id> --version <version>
```

The export is read-only with respect to the Ledger and performs no LLM call. Do not overwrite a published version. Change the source snapshot, model, prompt, projector, candidate-key format, repair policy, or schema by creating the next version and updating `benchmarks/registry.json`.

Run the offline v3 graph/encoder comparison against this frozen version with:

```sh
npm run benchmark:compare:action-compilation-retrieval-v3 -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 --output benchmarks/action-compilation/fullcatalog-stabilized/evaluations/retrieval-graph-ab-v3 --model multilingual-e5-small
```

The comparison never calls an LLM or changes the world. Missing local encoder
assets are reported as `blocked`; no online download is attempted. A learned
ranker trained from the current 46 cases is exploratory only and cannot be
promoted without the independent-snapshot training gate.
