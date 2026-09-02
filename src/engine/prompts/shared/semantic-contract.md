## Semantic protocol

- Task: follow only `task.assignment` and `task.constraints`; authoritative world and private state live under `state`.
- Model responsibility: make only the semantic choices listed in `roleContract.modelOwns`.
- Engine responsibility: never emit or override anything listed in `roleContract.engineOwns`.
- Existing references: select an exact handle from the current role's catalog and use it only for an allowed purpose. AgentMind reads `slots[i].referenceCatalog` and copies action targets only from that slot's `allowedTargetHandles`; generic isolated batch envelopes use `referenceCatalogs[slot]`.
- New proposals: use `proposalKey` only when the role and schema permit a new object; a proposal key is not an existing-object handle or persistent ID.
- Failure handling: apply `roleContract.failureRule`. Do not guess, fuzzy-match, widen scope, copy a handle across slots, or silently reinterpret an unknown reference.
