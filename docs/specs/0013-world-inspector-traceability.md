# World Inspector Traceability Workbench

Artifact-Version: 1
Status: Implemented

## Intent

Make every world evolution attempt auditable from one trusted local workbench without changing Truth Engine semantics, model selection, batching, transaction behavior, or cognitive isolation.

The Inspector keeps the existing three-column layout: Agent/world index, execution surface, and selected-object detail. The execution surface exposes calls, stages, and causal graph views. Failed attempts remain visible even when no Revision is committed.

## Contract

Inspector API v9 projects the hierarchy `Run/Advance → Attempt → Stage → Logical Invocation → Transport Attempt → Runtime Event → Artifact` from the Execution Ledger. Logical invocations, physical transport attempts, semantic rejection, repair, retry, tokens, UTF-8 byte measurements, queue/transport/parse timing, slot mappings, validation codes, event IDs, and artifact hashes remain separate facts. Public invocation IDs are normalized as `executionId::sourceInvocationId`; the original producer ID remains available as `sourceInvocationId`. Local Debug query projections provide exact lookup by invocation, execution, request, trace, span, event, artifact, and diagnostic code without changing the Ledger fact source.

`GET /api/instances/:id/inspector/model-invocations` accepts execution, Agent, role, provider, model, status, duration, input-token, retry, sort, and cursor filters. The invocation detail route returns metadata and event/payload references; complete request, context, response, and structured output bodies remain lazy runtime-event artifacts and pass existing redaction.

Slot and Agent mappings are derived only from persisted request/context fields. Missing identity is represented as unresolved. The Inspector does not infer relevant context or classify records as slow, long, risky, or anomalous.

The calls view is the default for active or failed attempts. Each invocation is selectable as one full card, transport rows are read-only metadata, and failure details link to the failed invocation and its validation evidence. Stage timeline rows and graph nodes use Chinese explanation plus technical identifiers. The persistent right column renders only the currently selected invocation, attempt, step, or graph node; time, change, causality, model links, and raw JSON are contextual sections rather than global tabs.

## Plan

Extend the shared v6 DTO, project invocation and actor activity facts in the server, add query and detail routes, connect the API client, and render the call list, invocation detail, stage timeline, and causal graph descendants. Keep payloads on demand and use existing runtime-event artifact readers.

## Verification

The projection tests prove two logical calls, three physical transports, one retry, slot identity, token/byte/timing separation, filtering, cursor paging, and payload omission from summaries. Component tests prove per-call/transport rendering and Agent/action search. Existing unit tests, type generation, lint, production build, and the repository accessibility suite are run for the change.

## Evidence

- [`world-inspector-api.ts`](../../src/shared/world-inspector-api.ts) — v6 DTO and query contract.
- [`world-inspector.ts`](../../src/server/world-inspector.ts) — Ledger projection, graph descendants, actor aggregation, query and detail projection.
- [`world-inspector-model-invocations.test.ts`](../../src/server/__tests__/world-inspector-model-invocations.test.ts) — logical/physical/retry and lazy payload assertions.
- [`world-inspector-invocation-list.test.tsx`](../../src/app/_components/world-inspector-invocation-list.test.tsx) — call list metrics and search behavior.
- [`world-inspector-invocation-list.tsx`](../../src/app/_components/world-inspector-invocation-list.tsx), [`world-inspector-detail.tsx`](../../src/app/_components/world-inspector-detail.tsx), [`world-inspector-timeline.tsx`](../../src/app/_components/world-inspector-timeline.tsx), and [`world-inspector-graph.tsx`](../../src/app/_components/world-inspector-graph.tsx) — traceability workbench UI.
