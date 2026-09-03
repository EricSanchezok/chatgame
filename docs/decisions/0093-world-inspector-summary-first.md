# World Inspector Summary-first Information Hierarchy

## Status

Accepted
Class: feature

## Context and Problem Statement

The trusted World Evolution Inspector has three persistent regions: a scope chooser, a center view, and a detail panel. When the center repeated transport, slot, payload, and explanatory audit text, the three regions no longer expressed increasing detail. Dense cards also made large invocation histories difficult to scan and encouraged the center to mount every record.

## Decision Drivers

- Keep the left–center–right desktop structure and the `调用 / 图谱 / 流程` view switch.
- Preserve Inspector API v9, Ledger evidence, lazy payload reads, and trusted local visibility.
- Give the center a stable summary layer that remains usable for large histories.
- Keep every audit field reachable without repeating it in multiple layers.
- Keep keyboard, RTL, forced-colors, reduced-motion, and narrow-width behavior intact.

## Considered Options

1. Continue adding fields to the existing center cards and detail panel.
2. Replace the three-column Inspector with a single evidence table.
3. Keep the three columns, make the center summary-first, and move low-frequency evidence behind detail disclosures.

## Decision Outcome

Use option 3. The left column selects the world or Agent scope. The center shows aggregate counts, trends, timestamps, compact records, semantic-stage graph nodes, and cursor/windowed history. The right column owns the selected object's complete audit evidence; technical groups are collapsed by default and payloads remain lazy. A single toolbar search handles local filtering and exact `executionId::sourceInvocationId` lookup.

The center does not repeat transport attempts, full slot mappings, payloads, context sections, or defensive causal explanations. Status uses text with a semantic color or rail. Icons are reserved for icon-only controls and essential status feedback. Timestamps provide temporal context; sorting controls name the available order without embedding an additional “latest first” explanation.

## Pros and Cons of the Options

### Existing evidence cards

- Pros: minimal implementation change and all fields remain visible.
- Cons: duplicates detail, weakens scanning, and scales poorly as records grow.

### Single evidence table

- Pros: compact and easy to virtualize.
- Cons: loses the established scope/detail navigation and makes graph and flow views inconsistent.

### Summary-first three columns (selected)

- Pros: preserves the trusted Inspector mental model, gives each column one responsibility, supports large histories, and keeps complete evidence available on demand.
- Cons: requires an explicit disclosure model, virtualized list behavior, and responsive container rules.

## Links

- [Trusted World-evolution Inspector](0055-trusted-world-evolution-inspector.md)
- [Failure-aware World Inspector](0057-failure-aware-world-inspector.md)
- [Agent-Native Debug Query Projections](0092-agent-native-debug-query-projections.md)
- [Inspector presentation contract](../game-design/presentation.md)
