# Unified Agent Perspective

## Status
Accepted
Class: architecture

## Context and Problem Statement

AgentMind receives a de-identified exact self-state while Participant and Observer surfaces independently expose raw character, belief, location, and observation structures. This duplicates the cognitive boundary, omits carried Entities and self-relevant world relations, and makes a human takeover less capable than the model policy it replaces. Adding Player inventory or asset modules would create privileged subjects and parallel truth sources.

## Decision Drivers

- Every actionable character remains the same Agent regardless of model, external, idle, or replay policy.
- Human and model consumers require one de-identified, authorization-limited view of exact and subjective state.
- Containment, ownership, gifts, property, goals, and arbitrary new predicates must remain script-driven and compositional.
- Reading the HUD must not become a world action or a second source of knowledge mutations.
- Complete histories remain the current model context; context retrieval and compaction are separate work.
- Inspector canonical access must remain physically separate from ordinary product projections.

## Considered Options

- Add Player-specific inventory, property, and HUD state.
- Keep separate AgentMind, Participant, and Observer view builders.
- Introduce one policy-independent Agent Perspective derived from canonical state and private Agent state -- selected.
- Expose canonical self-related state directly and rely on the client to hide sensitive fields.

## Decision Outcome

The engine owns a pure `projectAgentPerspective(state, agent)` function. Its result contains local self identity, exact current self mechanics and containment, authorization-filtered self-relevant Facts, the Agent's complete character and belief structures, and complete subjective history. It does not depend on Participant or PolicyBinding state and contains no canonical identity binding, remote canonical placement, private Fact, or another Agent's cognition.

Only unambiguous local bindings identify canonical contained or related Entities. Unbound or ambiguous contained Entities become response-scoped unidentified non-targetable nodes. Authorized Facts may introduce a read-only related node because the Fact itself grants visibility, but they do not create persistent belief or binding state. Exact relations and subjective claims remain separate when inconsistent.

AgentMind, reaction, grounding, Observation rendering, Arrival generation, Participant projection, and Observer projection consume this boundary. Truth retains complete canonical semantic history and AgentMind retains complete subjective history. Opening the human relationship workspace only re-reads the latest committed revision and never submits an action, advances time, writes belief, or creates conversation content.

World API v8 exposes the unified perspective and removes the raw parallel Participant and Observer DTOs. The projection is derived and does not change world schema v9, SimulationState v9, WorldInstance v13, persistence, replay, or world script capabilities. The host renders open predicates generically; it does not classify ownership, health, currency, friendship, or any other game-specific term.

### Consequences

- Model and human control share one cognitive capability boundary and preserve role continuity across takeover.
- Arbitrary items and relations become visible without dedicated framework modules or predicate registries.
- A self-contained but unidentified Entity can reveal that something is present without revealing its canonical identity.
- The read model can be larger because it deliberately retains complete Agent history.
- Worlds cannot replace the relationship workspace or inject client logic; unfamiliar semantics use the generic relation presentation.

## Pros and Cons of the Options

### Player-specific modules

- Good: conventional inventory and property screens are easy to implement.
- Bad: duplicates canonical state, privileges one policy, and binds the engine to familiar game genres.

### Separate consumer projections

- Good: each surface can optimize its payload independently.
- Bad: cognition and authorization drift, especially during control transfer.

### Unified Agent Perspective

- Good: one tested boundary serves every Agent and every policy while preserving open predicates and exact mechanics.
- Bad: the DTO must carry both exact and subjective structures and the UI must explain their difference.

### Canonical self-related client filtering

- Good: the server implementation is small.
- Bad: hidden state crosses the trust boundary and client mistakes become information leaks.

## Links

- [Approved unified perspective specification](../specs/0001-unified-agent-perspective.md)
- [0032](0032-open-world-facts-and-d20-kernel.md) -- open Facts, containment, and generic numeric mechanics.
- [0037](0037-agent-evolution-self-awareness-and-reaction-window.md) -- de-identified exact self-state and cognitive isolation.
- [0061](0061-unified-agent-and-external-policy.md) -- policy-independent Agent identity.
- [0064](0064-conversation-core-and-agent-perspective-observer.md) -- Participant, Observer, and Inspector projection boundaries.
