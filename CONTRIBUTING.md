# Contributing

Living World Engine is agent-native: human and AI contributors follow the same governance loop.

## Workflow

1. Read [AGENTS.md](AGENTS.md), [the documentation standard](docs/AGENTS.md), and the owning product specification.
2. Start a risk-boundary change with an Approved [Spec](docs/specs/README.md). Record a [decision](docs/decisions/README.md) only for a durable choice with genuine alternatives.
3. Add or update the smallest sufficient behavior evidence. A bug fix links an existing deterministic reproduction or adds a regression test.
4. Run `node scripts/run-gates.mjs` and the checks for the touched surface; run `npm run check:fast` before committing.
5. Commit each independently verifiable work unit immediately after its gates pass. Keep unrelated changes out and never push without explicit authorization.
6. Add a [postmortem](docs/postmortems/README.md) when a subtle, systemic, or costly failure reaches a user, merged change, or release.

## Pull requests

Use the pull-request template. Reviewers use the resident `repo-review` skill and verify the linked Spec, decision, evidence, and provenance appropriate to the change.

## Conduct

Be respectful, constructive, and generous in interpretation.
