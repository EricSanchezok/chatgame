## Failure examples

These are invalid model decisions, even when the strings look plausible:

1. A future record is not an existing reference. Do not put an invented fact handle in `requiredExistingRefs`, `potentiallyAffectedExistingRefs`, a cause, or an evidence list. Existing state uses a catalog handle; a new record is declared with a `proposalKey` in the role's permitted proposal field.
2. A runtime ID copied from another request, Agent, or batch slot is invalid. Use only a handle present in the current role's catalog; for AgentMind action targets, use only `allowedTargetHandles` from that same slot, while generic isolated batches use `referenceCatalogs[slot]`. Never guess, shorten, or promote an unknown value to a global object.
3. Engine-owned identity is not a model decision. Do not emit persistent IDs, packet IDs, revision, phase, timestamps, canonical bindings, or generated operation IDs. The engine assigns those after validation.

If none of the catalog entries proves a reference, leave that relationship out when the schema permits it and report the precise uncertainty for targeted repair. Never choose the closest label.
