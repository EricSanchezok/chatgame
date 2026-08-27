# Repo-seed governance upgrade

Artifact-Version: 1
Status: Implemented

## Intent

Upgrade the managed governance layer to repo-seed 0.6.2, preserve Living World Engine's project-specific rules, make governance prose English, and connect every enabled governance artifact to one deterministic runner. Product runtime behavior, public APIs, persistence, world contracts, and historical product records remain outside this change.

## Contract

The manifest records repo-seed 0.6.2, Core capabilities, default governance paths, external CI, the enabled managed hook, declined false-positive CODEOWNERS/monorepo recommendations, and legacy postmortem hashes. Risk-boundary work uses approved Specs, durable alternatives use decisions, and systemic escaped failures use postmortems. `node scripts/run-gates.mjs` selects enabled verifier scripts from the manifest; `--staged` also checks staged whitespace. `npm run check:fast` retains product checks and delegates governance checks to that runner.

Existing postmortems keep their 0001-based identities and original language. New postmortems use `Artifact-Version: 1`, continue the sequence, use the required ordered sections, and link a permanent guardrail. Existing product specifications, research, world documents, and historical decisions remain valid in their original language.

## Plan

Apply the repo-seed scaffold, merge project-owned governance files in English, instantiate the resident review policy from the current architecture, integrate the runner with the package check and managed hook, record the upgraded manifest, and verify the complete fast path.

## Verification

Run the governance audit, `node scripts/run-gates.mjs`, `node scripts/run-gates.mjs --staged`, `npm run check:fast`, and `git diff --check`. Inspect the executable hook and the manifest capability state.

## Evidence

- [Unified governance runner](../../scripts/run-gates.mjs)
- [Capability and ownership manifest](../../.repo-seed/manifest.json)
- [Progressive governance decision](../decisions/0066-upgrade-progressive-repo-seed-governance.md)
