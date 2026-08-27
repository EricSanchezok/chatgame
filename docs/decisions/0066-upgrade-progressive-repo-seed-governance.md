# Upgrade to progressive repo-seed governance

## Status
Accepted
Class: process

## Context and Problem Statement

Living World Engine uses a repo-seed-managed governance layer. Its live policy needs one manifest-selected gate runner, risk-triggered Specs, capability state, incident verification, and a safe resident workflow for future governance evolution. Project-specific engine invariants, automatic gated local commits, external CI, Unicode documentation, and existing historical artifact identities remain repository requirements.

## Decision Drivers

- Match governance ceremony to actual risk instead of using decisions as a change log.
- Preserve one source of truth for gate selection and capability state.
- Keep project-owned policy and historical records stable across upstream upgrades.
- Make future governance upgrades auditable and deterministic.
- Keep CI and local commits aligned without changing application runtime behavior.

## Considered Options

- Keep the repo-seed 0.3 governance layer unchanged.
- Refresh every upstream file and discard project customization.
- Add new gates beside the existing command lists without a shared runner.
- Upgrade to repo-seed 0.6.2, merge project policy, and adopt progressive artifacts with one manifest-selected runner.

## Decision Outcome

The repository uses repo-seed 0.6.2 Core capabilities for the baseline, Specs, decisions, and postmortems. `scripts/run-gates.mjs` selects enabled governance gates from `.repo-seed/manifest.json`; the authorized pre-commit hook calls it with `--staged`, and `npm run check:fast` calls it after the existing workflow verifier. GitHub Actions remains the external CI source.

Risk-boundary changes require an Approved Spec. Decisions are written only for durable choices with meaningful alternatives. Subtle, systemic, or costly escaped failures require a postmortem linked to a permanent guardrail. The automatic gated local-commit policy in [0058](0058-timely-gated-local-commits.md) remains in force.

Governance files use English. Historical product specifications, research, decisions, postmortems, and world documents remain in their original language. The 34 unversioned postmortems are content-grandfathered and keep their 0001-based identities; versioned records continue that sequence.

The resident review policy and project-customized Unicode link and legacy postmortem verifiers are project-owned. CODEOWNERS and monorepo capabilities are declined because generated `.next` and `.synergy` trees create package-count false positives in the generic audit; the repository has one real package root.

## Pros and Cons of the Options

### Keep repo-seed 0.3

- Good: no immediate governance edit.
- Bad: no Specs, capability state, incident verifier, shared runner, or resident governance-evolution workflow.

### Replace project policy with upstream templates

- Good: every file exactly matches upstream.
- Bad: loses engine-specific review invariants, automatic commit policy, Unicode anchor behavior, and historical artifact identity.

### Add parallel gate commands

- Good: individual scripts can be introduced independently.
- Bad: hook, CI, and contributor commands drift because gate selection has multiple homes.

### Upgrade and merge project policy

- Good: gains progressive governance and deterministic selection while preserving repository knowledge.
- Bad: a small set of project-owned files requires deliberate review during future upgrades.

## Links

- [0013 — Adopt repo-seed governance layer](0013-adopt-repo-seed-governance-layer.md)
- [0058 — Timely gated local commits](0058-timely-gated-local-commits.md)
- [Upgrade Spec](../specs/0000-repo-seed-governance-upgrade.md)
- [Update strategy](../../.repo-seed/update-strategy.md)
