# FullCatalog C3 stabilized behavior

Versioned artifacts are exported under `v1/` from recorded game executions. The exporter reads the production Action Compilation C3 evidence and stores only slots that the production compiler accepted after its existing semantic repair path.

Each accepted slot case references one deduplicated full C3 context using `contextHash` and `slotIndex`. `requiredCandidateKeys` contains the final resolved candidate keys, sorted and deduplicated. It is a behavioral reference to the stable production path, not a claim that the model's selection is semantically perfect.

Export a version with:

```sh
npm run benchmark:export:action-compilation-reference -- --database .livingworld-v20/livingworld.sqlite --execution <execution-id> --version <version>
```

The export is read-only with respect to the Ledger and performs no LLM call. Do not overwrite a published version. Change the source snapshot, model, prompt, projector, candidate-key format, repair policy, or schema by creating the next version and updating `benchmarks/registry.json`.
