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

- `LIVINGWORLD_DATA_ROOT` selects the local data directory and defaults to `.livingworld-v20/`. World versions, World Instances, WorldRuns, reaction preparations, model-registry snapshots, and the Execution Ledger share the data root; the SQLite records live in `livingworld.sqlite`. World Instance schema v20 embeds SimulationState v15 and its pinned algorithm reference; it does not read older saves, so use a new data root for another format.
- `LIVINGWORLD_MODEL_CATALOG_PATH` selects the complete model catalog and defaults to `config/models.yaml`.
- Each provider's `api_key_env` names its credential environment variable. A credential is required only when the world or an Agent uses that provider's Profile. The bundled Blackmarsh reference world uses DeepSeek profiles pinned to `deepseek-v4-flash` with thinking disabled and therefore requires `DEEPSEEK_API_KEY` (unless its profiles are intentionally overridden for a test).
- Normal execution, failure diagnosis, model I/O, and experiment evidence always enter the SQLite Execution Ledger. There is no `off|metrics|full` product switch or log directory; [Runtime observability](game-design/runtime-observability.md) owns the data boundary.

Model selection, reasoning effort, timeouts, output limits, roles, and concurrency belong only to the [model catalog and Gateway](game-design/model-gateway.md). Environment variables do not provide per-field overrides.

Use `npm run models:status` to inspect catalog health, credential presence, and deterministic Profile resolution; use `npm run models:refresh` to request a rate-limited models.dev refresh. `npm run test:live:model -- --account <account-id>` is an explicit, credentialed transport smoke test for one configured account.

For local live smoke tests, use the profile set that matches the active world configuration: `npm run test:live:deepseek` for the bundled Blackmarsh world, or the explicit `npm run test:live:qwen` and `npm run test:live:glm` commands when those profiles are selected. The DeepSeek account uses `DEEPSEEK_API_KEY`; the Qwen campus account uses `INF_API_KEY`. Unit tests continue to use the deterministic test provider.

### Switching model profiles

Update every model-profile reference in the bundled world's `script.yaml` and entity YAML files, then run `npm run world:validate -- worlds/blackmarsh/world` and `npm run models:status`. A catalog Profile declaration alone does not change a world that is already persisted in the local catalog.

The local world catalog and every World Instance are immutable snapshots. After changing a bundled world's model profiles, finish or remove test instances, create a fresh data root (or explicitly re-import the world with `--replace` when no instances remain), and restart the development server. Do not edit a pinned instance to change its producer; verify a newly created instance's Inspector reports the intended account, profile, and model before spending time on multi-step runs.

Before a full live run, call `npm run test:live:model -- --account <account-id>` once for the selected account. For private gateways, pass the account's documented physical-interface environment variable at process start; do not change global VPN routes or commit the resolved address. Compare the provider context ceiling with the Profile's `max_input_bytes` plus `max_output_tokens`, leaving response headroom and enabling deterministic batch bisection when large slot sets approach the limit.

When the local TUN route cannot reach the Qwen gateway, start the process with
the physical-interface address in `QWEN_LOCAL_ADDRESS`, for example:
`QWEN_LOCAL_ADDRESS="$(ipconfig getifaddr en0)" npm run dev`. This opt-in
transport is scoped to `qwen-campus`; other model accounts keep the default
Node route. Do not commit the resolved address or any credential.

Use `npm run experiment:run -- --agents 1,10,50,1000 --steps 1` for the deterministic scale matrix. Replay, comparison, and export commands are defined by [Runtime observability](game-design/runtime-observability.md#研究命令).

Algorithm selection and opaque configuration are immutable internal instance settings. Execution Contract v5 provides `bootstrap`, persistable Preparation v4 through `prepareStep`, and `completeStep`; new algorithms register a versioned, JSON-safe definition that derives a manifest and implementation from configuration, while stable telemetry and commit validation remain engine-owned. The built-in `eager-reference@10` defaults Action Compilation to twelve slots, AgentMind to eight, Reaction to eight, Action Grounding to sixteen, and Truth Engine fixed batches to twelve, and remains the explicit experiment default.

## Source attribution

When implementation is materially derived from a paper, article, benchmark, research report, community post, or copied/adapted code, preserve provenance at the closest stable repository location. Cite a local algorithm, formula, constant, workaround, or behavior in a nearby `Source:` comment; cite cross-cutting design in the owning decision; retain source metadata and satisfy copyright, license, and NOTICE obligations for generated, copied, vendored, or adapted material. A pull request, issue, prompt, or chat transcript is not a durable source of truth.

## Working tree

The manifest owns seeded governance files and preserves project modifications during upgrades. Re-run repo-seed to adopt upstream governance; edit project-owned policy deliberately and re-record it through the skill.

## Product constraints

The engine remains server-only and public DTOs remain in `src/shared/`. Do not reintroduce action enums, old-save migration, executable world scripts, browser-side truth, or a second state-commit path. Frontend components consume only `--cg-*` color variables.
