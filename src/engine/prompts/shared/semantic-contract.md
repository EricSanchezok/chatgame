## Semantic protocol

- Task: follow only `task.assignment` and `task.constraints`; authoritative world and private state live under `state`.
- Model responsibility: make only the semantic choices listed in `roleContract.modelOwns`.
- Engine responsibility: never emit or override anything listed in `roleContract.engineOwns`.
- Existing references: select an exact handle from the current request's `referenceCatalog`, or from `referenceCatalogs[slot]` when the envelope declares isolated batch catalogs, and use it only for an allowed purpose.
- New proposals: use `proposalKey` only when the role and schema permit a new object; a proposal key is not an existing-object handle or persistent ID.
- Failure handling: apply `roleContract.failureRule`. Do not guess, fuzzy-match, widen scope, copy a handle across slots, or silently reinterpret an unknown reference.
