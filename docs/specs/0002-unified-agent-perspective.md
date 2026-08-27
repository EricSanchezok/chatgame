# Unified Agent Perspective

Artifact-Version: 1
Status: Approved

## Intent

Give every Agent one policy-independent, cognitively isolated perspective that both AgentMind and human-facing surfaces consume. The perspective must make exact self state, carried entities, authorized self-relevant relations, subjective beliefs, character state, and the complete subjective history playable without introducing Player, Inventory, Asset, or Property state. Opening the perspective surface is a read and does not advance or mutate the world. Memory retrieval, summarization, compaction, custom world UI, and a semantic-role registry are outside this change.

## Contract

`projectAgentPerspective(state, agent)` is a pure deterministic projection that does not receive Participant or PolicyBinding state. It exposes the Agent's local self identity, current revision, step, time, location, exact self mechanics including visible Conditions, self containment, authorized self-relevant Facts, character, beliefs, evidence, and complete subjective history. Each history turn carries only the ResolutionReceipt view allowed by its disclosure policy. It never exposes canonical Entity, placement, Fact, Meter, Rating, Condition, ResolutionPlan, ResolutionReceipt, or action identities, provenance, or another Agent's private identities or cognition.

Containment resolves an Entity to a local identity only when the binding is unambiguous. Unbound or ambiguous contained Entities appear as response-scoped unidentified presences and cannot become action targets. Exact Facts include public or explicitly Agent-authorized relations involving self, carried Entities, and one directly related hop; private Facts and remote canonical placement never enter the projection. Exact state and subjective claims coexist when they disagree.

The same projection supplies AgentMind, reaction, grounding, Observation rendering, Arrival generation, Participant control, and Observer selection. AgentMind and Truth continue to receive the complete chronological subjective and semantic histories without retrieval, summarization, or truncation. The Participant HUD is a read-only relationship workspace; its absence or presence never changes simulation state or emits a conversation turn.

Public World API v8 replaces the raw Participant and Observer character/belief DTOs with the unified perspective. The projection consumes schema v10 and SimulationState v10 without changing WorldInstance v14 persistence, replay hashes, or Route Handler paths.

## Plan

Add the engine-owned perspective projection and self-consequence observability guard, route every model and product consumer through it, replace the duplicate Participant and Observer DTOs, and replace the raw character JSON overlay with a cognitively safe relationship graph plus a mobile semantic list. Remove the former self-state and raw-view paths in the same change.

## Verification

Verify deterministic de-identification, Fact access, containment ambiguity, complete subjective history, policy independence, model-context ownership, Participant/Observer equality, and absence of remote canonical placement. Exercise dynamic grass collection, gifted and misplaced keys, remote property ownership, unauthorized relations, control transfer, worlds without meters, responsive graph/list rendering, keyboard navigation, reduced motion, and accessibility. Run `npm run check:fast` and the relevant browser and accessibility projects in an isolated data root.

## Evidence

- Engine projection and self-consequence boundary: [`agent-perspective.test.ts`](../../src/engine/__tests__/agent-perspective.test.ts).
- Policy-independent Participant, Observer, and Arrival projection: [`world-instance-host.test.ts`](../../src/server/__tests__/world-instance-host.test.ts) and [`instance-routes.test.ts`](../../src/app/api/__tests__/instance-routes.test.ts).
- Generic relationship graph construction: [`agent-perspective-workspace.test.ts`](../../src/app/_components/agent-perspective-workspace.test.ts).
- Desktop graph, mobile semantic list, control continuity, and accessibility: [`immersive-game.spec.ts`](../../e2e/flows/immersive-game.spec.ts) and [`immersive-game.a11y.spec.ts`](../../e2e/a11y/immersive-game.a11y.spec.ts).
- Repository verification: `npm run check:fast` and an isolated production build plus targeted Playwright `e2e` and `a11y` projects.
