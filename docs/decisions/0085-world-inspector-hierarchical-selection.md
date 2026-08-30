# World Inspector Hierarchical Selection

## Status

Accepted
Class: architecture

## Context and Problem Statement

The Inspector showed ownership filters, record collections, and record evidence in the same visual layer. A universal detail tab strip obscured which object was being inspected, invocation cards contained nested slot controls, and model invocation IDs collided when records from multiple executions were flattened into one list. JSON evidence also used inconsistent disclosure surfaces and excessive spacing, making long keys, IDs, and narrative values difficult to audit.

## Decision Drivers

- Make ownership, collection, and evidence responsibilities visible in the three-column layout.
- Keep the right column stable while real-time updates replace the middle collection.
- Expose one unambiguous selection target for every model invocation.
- Provide globally unique public invocation IDs without changing persisted runtime events.
- Keep complete evidence available while making common JSON inspection compact and readable.
- Preserve keyboard navigation, focus visibility, narrow layouts, RTL, and forced-colors behavior.

## Considered Options

1. Keep the universal summary/time/change/causality/model/raw tab strip and add more labels.
2. Keep producer-local invocation IDs and synthesize React keys in the client.
3. Rebuild the Inspector as ownership filter → record collection → selected-record detail, with a server-normalized invocation identity.
4. Replace tree inspection with raw JSON only or with separate bespoke viewers for each evidence type.

## Decision Outcome

The Inspector uses a hierarchical three-column contract. The left column selects the whole world or one Agent. The middle column retains Calls, Timeline, and Graph collections. The right column renders the current discriminated selection (`invocation`, `attempt`, `step`, `node`, or empty) and no longer exposes a universal detail tab strip. Time, state changes, causality, related model calls, and raw runtime evidence are explicit contextual sections. Related calls can open the Calls collection and select the invocation detail.

Inspector API v7 normalizes every public invocation ID to `${executionId}::${sourceInvocationId}` and carries the producer-local ID as `sourceInvocationId`. Query results, step and attempt details, graph relations, React keys, selection state, and detail lookup use the normalized ID. Persisted events remain unchanged, and detail lookup still receives the execution ID separately so the source event group is unambiguous.

Invocation cards are single native buttons spanning the complete card. Slot previews are compact and read-only; the complete mapping is a four-column table in invocation detail. JSON evidence uses a compact disclosure tree keyed by JSON path plus a raw-text mode with copy, one-level expansion, full expansion, and full collapse. Large arrays render in batches while raw text remains complete. Native disclosure is reserved for structural sections, not card-internal popup menus.

## Pros and Cons of the Options

### Universal tabs with more labels

- Pros: preserves the existing component surface and familiar tab mechanics.
- Cons: keeps unrelated object types mixed together, hides selection context, and encourages panels whose content changes meaning without changing the surrounding frame.

### Client-only key synthesis

- Pros: a small visual bug fix with no DTO change.
- Cons: leaves the public contract ambiguous, permits incorrect selection and pagination deduplication, and cannot reliably route a detail request across executions.

### Hierarchical selection with server-normalized IDs (selected)

- Pros: ownership, collection, and evidence have one responsibility each; the entire card is selectable; real-time refresh can preserve the selected object; and the normalized identity is reusable by APIs, graph relations, and audit tooling.
- Cons: API v7 is a breaking projection contract, and the right column needs contextual empty/reselection states when a selected object disappears.

### Raw-only or bespoke JSON viewers

- Pros: raw-only output is complete, while bespoke viewers can optimize one evidence shape.
- Cons: raw-only output is hard to scan and bespoke viewers multiply interaction patterns. A compact tree plus raw text keeps scanability and audit completeness in one reusable component.

## Links

- [World Inspector traceability spec](../specs/0013-world-inspector-traceability.md)
- [Edge JSON Viewer explainer](https://microsoftedge.github.io/DevTools/explainers/JSONViewer/explainer.html)
- [MDN `details` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)
