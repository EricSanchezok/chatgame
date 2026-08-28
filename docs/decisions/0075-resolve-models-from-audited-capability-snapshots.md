# Resolve models from audited capability snapshots

## Status

Accepted
Class: architecture

## Context and Problem Statement

The model gateway binds provider kinds, model IDs, and provider-specific inference unions inside one static catalog. Adding an account changes core schemas and adapters, while moving model families make a checked-in ID stale. Provider-compatible model list APIs usually expose availability but not enough information to compile reasoning controls, structured output, modalities, or limits. Resolving remote metadata during each transport would instead make one world execution internally inconsistent and would let an external catalog influence credential destinations.

## Decision Drivers

- Existing provider accounts and subscription channels must coexist without duplicating protocol implementations.
- New model releases must become selectable without an engine release, while exact model requests remain exact.
- Model selection, parameter compilation, and external metadata must be attributable and replayable.
- Provider endpoints, credentials, and semantic failure behavior must remain local and trusted.
- One execution must use one model-catalog view even under concurrent background refresh.
- Structured world output must remain locally validated without Markdown or prose recovery.
- Missing credentials and provider failures must not trigger a model or provider fallback.

## Considered Options

- Continue one hard-coded adapter and inference union per provider account.
- Route every provider through one unrestricted OpenAI-compatible option bag.
- Combine provider inventories, public aggregators, documentation scraping, and paid active probes at runtime.
- Use models.dev alone for remote metadata, local trusted accounts and overrides, protocol drivers, vendor dialects, and immutable execution-scoped snapshots — the selected option.

## Decision Outcome

`config/models.yaml` schema v3 defines provider accounts separately from profiles. An account selects a registered protocol driver and vendor dialect and owns its trusted base URL, credential environment variable, channel, region, models.dev provider identifier, and concurrency. OpenAI Chat, OpenAI Responses, and Anthropic Messages own wire contracts. Dialects own normalized inference mapping, safe headers, usage, errors, and structured-output support. Adding another account for an existing combination changes configuration only; a genuinely new wire dialect adds one registered module without extending the core catalog schema.

Models.dev is the only remote metadata source. The registry ignores its endpoint, package, and credential fields for execution. A strict normalized subset with per-field models.dev or local-override provenance is stored as immutable content-addressed snapshots under the local data root. Refresh is conditional, hourly, single-flight, and last-known-good. Invalid or unavailable refreshes never replace an active snapshot.

Profiles use exact or latest-compatible selectors. Latest-compatible resolution is deterministic and capability-constrained; explicit controls cannot be dropped, renamed, clamped, or converted to a weaker value. `auto` means omission. Exact unavailable models and unresolved latest selectors fail. Runtime failures retain the on-demand credential boundary established by [0047](0047-on-demand-model-provider-credentials.md) but never activate another account.

The gateway binds one snapshot to one execution. Interactive executions may use a newer snapshot at their next boundary. Benchmark and replay executions can require historical snapshot evidence. Audits persist requested and resolved identities and inference, configuration and metadata hashes, protocol, channel, and output strategy. Strict JSON Schema, JSON object with local Zod, and forced tool call with local Zod are the only structured-result paths.

Zhipu API and Coding Plan, MiniMax API and Token Plan, Kimi API and Coding Plan, MiMo API and Token Plan, DeepSeek, OpenAI, and xAI are trusted local accounts. SuperGrok is not an xAI API account. Provider-specific subscription terms and quota failures are surfaced without client impersonation or fallback.

## Pros and Cons of the Options

### Hard-coded provider adapters and inference unions

- Good: every supported payload is statically explicit in one place.
- Bad: account growth repeatedly changes core schemas, and checked-in model IDs age with every provider release.

### Unrestricted OpenAI-compatible option bag

- Good: adding endpoints requires little code.
- Bad: unsupported parameters become runtime surprises, protocol differences disappear, and auditing cannot state which semantics were actually compiled.

### Multiple remote sources and paid probes

- Good: can discover more account-specific availability and confirm some live behavior.
- Bad: provenance arbitration, rate limits, costs, and transient failures make selection harder to explain and reproduce.

### One remote catalog with local trust and execution snapshots

- Good: model evolution is automatic, provenance remains compact, credential destinations stay local, and executions remain internally stable.
- Bad: models.dev can lag or list a model unavailable to one account; those cases fail explicitly or require a local override.

## Links

- [Approved dynamic model-provider registry Spec](../specs/0007-dynamic-model-provider-registry.md)
- [0047](0047-on-demand-model-provider-credentials.md) — superseded on-demand credential contract retained here.
- [0059](0059-unified-execution-kernel-and-ledger.md) — execution identity and evidence boundary.
- [models.dev API and schema](https://github.com/anomalyco/models.dev/blob/dev/README.md#api)
- [models.dev synchronization policy](https://github.com/anomalyco/models.dev/blob/dev/sync.md)
- [Zhipu Coding Plan quick start](https://docs.bigmodel.cn/cn/coding-plan/quick-start)
- [MiniMax Token Plan](https://platform.minimaxi.com/docs/token-plan/intro)
- [Kimi Code](https://www.kimi.com/code/docs/en/)
- [MiMo API quick start](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call)
- [xAI API quick start](https://docs.x.ai/developers/quickstart)
