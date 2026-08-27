---
name: repo-review
description: Use when reviewing a pull request or a change in this repository — orients the reviewer to this repository's standards, durable artifacts, and project-specific invariants that code alone cannot show
---

# Reviewing a change in this repository

Read the diff, owning product specifications, applicable Specs, decision log, and enough surrounding code to understand the design before judging it. Blocking requirements are hard; manual checks rank the remaining risk and apply only to touched surfaces.

## Sources of truth

- [AGENTS.md](../../../AGENTS.md): standing repository and product rules.
- [docs/AGENTS.md](../../../docs/AGENTS.md): documentation placement and prose discipline.
- [docs/specs/](../../../docs/specs/README.md): risk-triggered change contracts.
- [docs/decisions/](../../../docs/decisions/README.md): durable design rationale.
- [docs/testing.md](../../../docs/testing.md): risk-to-layer selection, topology, and evidence rules.
- [docs/architecture.md](../../../docs/architecture.md): module map and seams.

## Blocking requirements

### Universal (applies to any repository)

1. **New prose receives semantic review.** Critically review every added or changed Markdown passage, JSDoc, comment, prompt, description, diagnostic, and visible string. Verify required coverage, accuracy, placement, and editorial quality against the owning code or behavior; automated checks do not establish those properties.
2. **Docs match the code.** Config, defaults, errors, wire fields, events, and public behavior update the owning docs and JSDoc in the same diff.
3. **Contracts and decisions use the right artifact.** A risk-boundary change has an Approved spec; a durable choice with real alternatives has a decision record. Do not demand an ADR as a change log.
4. **Tests provide minimum sufficient behavior evidence.** Name the meaningful regression each changed test prevents and place its primary evidence at the lowest sufficiently real boundary. A fix links an existing deterministic reproduction or adds a regression test that fails before the fix and passes afterward; redundant coverage or implementation-only assertions do not satisfy this requirement.
5. **External-source provenance is retained.** If implementation is materially derived from a paper, article, community post, benchmark, research report, or copied/adapted code, cite it at the closest stable code location or link that location to a decision record whose `## Links` cites the source. A pull request, issue, prompt, or chat-only citation does not count; copied or adapted material also preserves applicable license and NOTICE requirements.

### Project-specific

1. **Keep the framework script-driven.** Lore, characters, and mechanics remain in world contracts; reject game-specific framework branches that bypass `src/script/` and the declared world format.
2. **Preserve authoritative execution and cognition.** Natural-language actions remain attempts, never state deltas; engine-owned validation, runtime identities, canonical truth, Agent beliefs, and player knowledge keep their separate owners.
3. **Keep the engine server-only.** Filesystem, YAML, model credentials, canonical bindings, and private cognition never enter browser code or ordinary public DTOs; browser access stays behind Route Handlers and the trusted Inspector exception remains read-only and local.
4. **Ship one forward-only path.** Breaking runtime, save, and schema changes remove old data, fixtures, compatibility paths, and superseded implementations instead of creating migrations or dual tracks.
5. **Use theme color tokens.** Component CSS consumes `--cg-*` variables and never adds hard-coded color values outside the root theme declarations.

## Manual checks

### Project-specific

- **Execution completeness:** trace action grounding through conflict components, random commitment, one outcome per joint action, one positive engine-owned time advance, one observation per living Agent, one required mind commit, and the atomic instance/Ledger terminal write.
- **Perspective isolation:** inspect exact prompts, schemas, DTOs, errors, and diagnostics received by AgentMind, Participant, Observer, and Inspector; search for canonical bindings, another Agent's beliefs, provider configuration, or internal failure material crossing an unauthorized boundary.
- **Lifecycle and persistence:** trace scheduler serialization, cancellation, deadline noops, generation fencing, revision CAS, process leases, reconnect/recovery, and cleanup on failure. A failed step leaves revision and canonical state unchanged while preserving its Execution Ledger evidence.
- **Contract symmetry:** changes to world schema, public APIs, Inspector DTOs, model fields, or persistence update the owning source under `src/script/`, `src/shared/`, or `src/server/`, the paired product specification, fixtures, and the lowest sufficiently real test in the same diff.
- **Rendered interface:** UI changes preserve assistant-ui/provider boundaries, dialog teardown, focus return, 320 px and 200% zoom behavior, forced colors, accessibility checks, and platform-specific visual baselines where geometry or rendering changes.

### Universal fallbacks (apply where the project has no specific rule)

- **Intent and interface contracts:** trace both sides of every changed interface. Confirm the implementation matches the change and any decision record, including errors, cancellation, ownership, and disposal.
- **Lifecycle and concurrency:** for async setup, callbacks, processes, or teardown, check races before publication, cancellation during awaits, independent error reporting, and complete cleanup.
- **Human readability:** read changed code from its entry point downward. The primary path stays understandable without opening every helper. Challenge abstractions that only forward or rename, mixed abstraction levels, misleading or generic names, new synonyms for existing concepts, and logic outside its owning boundary. Block when these make behavior unreliable to infer, hide effects or cost, or violate established vocabulary or boundaries; otherwise report subjective polish as advisory. Line counts, parameter counts, duplication, and complexity scores are signals, not verdicts.
- **Scope and necessity:** map each abstraction, option, defensive copy, and compatibility path to its current contract and consumer. Challenge unrelated features and speculative generality.
- **Bounds cover the final operation:** probe tiny and exact limits, oversized chunks, and multibyte text for byte limits.
- **Test value and boundary:** identify the contract each changed test owns, challenge duplicate evidence, and use the real shipped entry path whenever packaging, configuration, process setup, or wiring is part of the risk.
