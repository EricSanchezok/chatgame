# Development

English is the working language for new governance artifacts and code. Existing product specifications and historical records remain valid in their original language. This document covers contributor setup and daily workflow; repository commands live in [AGENTS.md](../AGENTS.md).

## Prerequisites

- Git
- Node.js 22 or a later dependency-supported LTS release

## Daily workflow

1. Read the root `AGENTS.md`, the owning product specification, and any applicable Spec.
2. Update behavior, documentation, the smallest sufficient test evidence, and any required Spec, decision, or postmortem in the same work unit.
3. Run the checks for the touched surface and `node scripts/run-gates.mjs`; run `npm run check:fast` before committing.
4. Commit the independently verifiable work unit immediately when its gates pass. Do not include unrelated user or task changes.
5. Do not commit when the user requests review/diagnosis only, checks fail, or changes cannot be separated safely. Never push without explicit authorization.
6. After adding, deleting, or renaming a Next.js dynamic route directory, restart `next dev` and request a real dynamic URL to verify HTTP 200; a process already occupying the port may hold a stale route table.

## Configuration

- `LIVINGWORLD_DATA_ROOT` selects the local data directory and defaults to `.livingworld-v15/`. World versions, World Instances, WorldRuns, and the Execution Ledger share `livingworld.sqlite`. World Instance schema v15 embeds SimulationState v11 and does not read older saves; use a new data root for another format.
- `LIVINGWORLD_MODEL_CATALOG_PATH` selects the complete model catalog and defaults to `config/models.yaml`.
- Each provider's `api_key_env` names its credential environment variable. A credential is required only when the world or an Agent uses that provider's Profile. The reference world requires only `DEEPSEEK_API_KEY`.
- Normal execution, failure diagnosis, model I/O, and experiment evidence always enter the SQLite Execution Ledger. There is no `off|metrics|full` product switch or log directory; [Runtime observability](game-design/runtime-observability.md) owns the data boundary.

Model selection, reasoning effort, timeouts, output limits, roles, and concurrency belong only to the [model catalog and Gateway](game-design/model-gateway.md). Environment variables do not provide per-field overrides.

Use `npm run experiment:run -- --agents 1,10,50,1000 --steps 1` for the deterministic scale matrix. Replay, comparison, and export commands are defined by [Runtime observability](game-design/runtime-observability.md#研究命令).

## Source attribution

When implementation is materially derived from a paper, article, benchmark, research report, community post, or copied/adapted code, preserve provenance at the closest stable repository location. Cite a local algorithm, formula, constant, workaround, or behavior in a nearby `Source:` comment; cite cross-cutting design in the owning decision; retain source metadata and satisfy copyright, license, and NOTICE obligations for generated, copied, vendored, or adapted material. A pull request, issue, prompt, or chat transcript is not a durable source of truth.

## Working tree

The manifest owns seeded governance files and preserves project modifications during upgrades. Re-run repo-seed to adopt upstream governance; edit project-owned policy deliberately and re-record it through the skill.

## Product constraints

The engine remains server-only and public DTOs remain in `src/shared/`. Do not reintroduce action enums, old-save migration, executable world scripts, browser-side truth, or a second state-commit path. Frontend components consume only `--cg-*` color variables.
