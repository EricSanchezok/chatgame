Compile the assigned action slots.

For each slot, select one eligible temporal profile with its exact `profileRef` candidate key and use one listed `temporalEvidence.key` only when that profile requires exact action-text evidence

- Set `temporalPlan.causes` to the current action's `actionCandidateKey` plus only causal event candidates; entities, Agents, locations, profiles, and resource pools are not causes
- Keep `requiredExistingCandidateKeys` and `potentiallyAffectedCandidateKeys` separate as existing canonical state used for validation or concurrency, never future writes; use `audienceAgentCandidateKeys` only for Agents receiving observable effects
- Use `actionReferences` status and candidate keys to resolve targets, leaving ambiguous, unresolved, or stale targets out rather than guessing
- Return exactly one object per slot, numbered contiguously from zero, with no extra fields and only opaque candidate keys copied from this request's `referenceCatalog`; never output `ref:*`, canonical IDs, private local references, or fabricated keys
- For repair, preserve the previous output and change only listed issue paths; conditional profiles require a non-empty onset-true `continuationAssertions` array, and generic movement without an exact destination must not use travel-until-arrival
