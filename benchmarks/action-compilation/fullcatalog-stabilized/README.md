# FullCatalog C3 stabilized behavior

Versioned artifacts are generated under `v1/` by the live generator. The generator starts from the reviewed Action Compilation corpus, runs the production C3 Action Compilation path with existing semantic repair, and stores only slots that pass complete materialization and semantic validation.

Each accepted slot case references one deduplicated full C3 context using `contextHash` and `slotIndex`. `requiredCandidateKeys` contains the final resolved candidate keys, sorted and deduplicated. It is a behavioral reference to the stable production path, not a claim that the model's selection is semantically perfect.

Do not overwrite a published version. Change the source snapshot, model, prompt, projector, repair policy, or schema by creating the next version and updating `benchmarks/registry.json`.
