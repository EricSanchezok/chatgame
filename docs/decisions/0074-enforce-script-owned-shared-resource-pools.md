# Enforce script-owned shared-resource pools in the canonical kernel

## Status

Proposed
Class: architecture

## Context and Problem Statement

The temporal runtime already prevents one Agent from exceeding its own declared Activity resources and causally reconsiders an ongoing Activity when another interaction overlaps its footprint. It does not represent capacity shared by several Agents. Consequently, independently valid actions can both use the same unique horse, occupy a one-person boat, or consume the last seats in a vehicle without a canonical invariant expressing that conflict.

Natural-language adjudication can explain who wins a contest, but it cannot be the authority for arithmetic capacity, stable queue order, or atomic multi-resource acquisition. Conversely, a universal first-come-first-served lock would make genre and world rules an engine policy and could not express immediate rejection or a dramatic contested handoff. The representation must remain script-driven while canonical commits remain strict.

## Decision Drivers

- Canonical state must never contain more granted claims than an available resource pool's capacity.
- Capacity, units, claim defaults, pause behavior, and contention semantics belong to the world script rather than engine action classes.
- One Activity needing several pools must acquire all claims or none, without partial locks or deadlock.
- Queues must be deterministic under replay and simulated time, independent of request timing or process restart.
- Truth may settle open semantic contention but may not invent capacity, quantity, or bypass a hard invariant.
- Sparse causal activation and zero irrelevant AgentMind calls must survive the addition of resource conflicts.
- External reaction waiting must preserve the exact prepared allocation state without a zero-time world commit.
- Public projections must preserve cognitive isolation while a trusted local Inspector remains operationally complete.

## Considered Options

- Let the LLM infer resource uniqueness and settle all contention in prose.
- Give every resource a universal engine-owned first-come-first-served lock.
- Encode capacity as ordinary mutable Facts and ask mechanics or Truth to honor them.
- Use canonical Entity resource pools, script-declared contention policy, and independent kernel validation — the selected option.

## Decision Outcome

World mechanics define typed shared-resource kinds. Canonical Entities instantiate pools with capacity, and the loader derives stable pool identities from the world hash, definition, and Entity. Grounding attaches structured claims to the same interaction dependency that owns read, write, participant, and audience evidence. Claim quantities have kernel-verifiable provenance: authored default, explicitly permitted action quantity, or trusted mechanic result.

An allocation kernel treats scheduled holders, retaining pauses, and ready reservations as existing demand. It grants every claim of an Activity atomically or grants none. Insufficient capacity follows the strongest policy among the requested pools: `adjudicate`, then `queue`, then `reject`. This priority selects a routing path, not an exemption from any pool's capacity.

`reject` produces a deterministic blocked result. `queue` orders entries by simulated enqueue time and stable Activity ID. `adjudicate` joins competing work and affected holders in one Truth component, but a winner may receive capacity only after the candidate legally releases the prior claims. The committer independently reconstructs and verifies this transition.

Queued Activities continue to own the Agent's foreground but own no pool capacity. A releasing positive-time commit promotes satisfiable queue heads to `ready` reservations by connected pool component. Processing stops at the first unsatisfied head in each component. `ready` work revalidates and receives a fresh TemporalPlan on the next ordinary positive-time step, so waiting never produces retroactive progress or a zero-time canonical transition.

Capacity changes are typed canonical operations with causal authorization. Retirement or reduction cannot strand holders above capacity. Terminal Activity dispositions release every claim; pause retention is authored per resource definition. Resource pool keys extend the exact interaction index so contention activates all and only the necessary interaction closure, subject to the existing conservative global fallback.

The ReactionWindow freezes the relevant preparation, including resource evidence, while canonical time and allocations remain unchanged. Ordinary clients receive permission-filtered status and resource names; the trusted Inspector receives pool, holder, queue, provenance, and adjudication detail.

## Pros and Cons of the Options

### LLM-only resource judgment

- Good: accepts arbitrary descriptions with no new canonical types.
- Bad: capacity arithmetic, queue order, replay, and adversarial candidate validation become nondeterministic model claims.

### Universal first-come-first-served locking

- Good: has simple deterministic allocation and familiar implementation techniques.
- Bad: hard-codes one contention behavior, cannot represent authored rejection or adjudication, and lets transport timing become game semantics.

### Capacity as ordinary Facts

- Good: reuses the open Entity/Fact model and existing semantic mutations.
- Bad: Facts are not typed conservation ledgers; contradictory or stale statements cannot safely authorize capacity or atomic multi-pool acquisition.

### Entity pools with authored policy and kernel validation

- Good: keeps world semantics open while capacity, provenance, FIFO, all-or-nothing allocation, replay, and commit atomicity remain independently enforceable.
- Good: resource-pool keys naturally extend the existing causal index without waking unrelated Agent policies.
- Bad: adds schema-versioned pool, claim, queue, reservation, capacity-operation, projection, and Inspector contracts.
- Bad: strict queue-head fairness can leave usable capacity idle until the head becomes satisfiable or leaves the queue.

## Links

- [Approved shared physical-resource capacity Spec](../specs/0006-shared-physical-resource-capacity.md)
- [0055](0055-trusted-world-evolution-inspector.md) — trusted local inspection exception.
- [0059](0059-unified-execution-kernel-and-ledger.md) — canonical transaction and Ledger authority.
- [0060](0060-model-output-field-ownership.md) — model-output ownership boundaries.
- [0063](0063-eager-reference-execution.md) — exact component execution and global fallback.
- [0067](0067-open-semantic-resolution-plans.md) — open semantic plans with strict commit authority.
- [0070](0070-event-boundary-temporal-runtime.md) — independent Activity time and positive boundaries.
- [0073](0073-stage-reactions-before-temporal-boundary-selection.md) — causal Activity interaction and persisted reaction preparation.
