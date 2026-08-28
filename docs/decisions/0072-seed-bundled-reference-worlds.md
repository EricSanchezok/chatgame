# Seed bundled reference worlds into a fresh local database

## Status

Accepted
Class: feature

## Context and Problem Statement

The reference-world layout in [0045](0045-versioned-reference-world-projects.md) keeps authoring evidence outside a strict runtime directory and requires every world to pass the ordinary archive importer. It also leaves a fresh application with an empty library and asks each player to package and import repository-owned content before the product is playable. Bundled content needs a zero-configuration installation path without becoming an engine special case or overwriting a library that the player already manages.

## Decision Drivers

- A fresh local installation must contain a playable world without a manual ZIP workflow.
- Bundled worlds must pass the same archive limits, schema validation, model-profile validation, rule-package validation, and content hashing as user-authored worlds.
- Existing local databases, custom worlds, and player-selected current versions must not be overwritten during ordinary startup.
- Deleting an installed bundled world must remain durable rather than causing it to reappear on every launch.
- Reference-world lore and mechanics must remain in the world project rather than entering the generic engine.
- Production output tracing must carry the strict runtime directories required by first-run installation.

## Considered Options

- Keep all reference-world installation manual.
- Reconcile bundled worlds into the catalog on every startup.
- Seed bundled worlds only when the local database schema is created — the selected option.

## Decision Outcome

Repository-owned reference worlds retain the `worlds/<world-id>/` author-project layout from [0045](0045-versioned-reference-world-projects.md). Documentation, attribution, and design evidence remain outside the strict `world/` runtime directory. The runtime directory remains subject to the same archive importer as an untrusted user ZIP; bundled worlds receive no loader or engine bypass.

`LocalDatabase` reports whether its schema was created by the current opening. `WorldHost` installs the declared bundled set only in that case. Installation constructs an in-memory archive from each strict runtime directory and submits it through `LocalDatabase.importWorld` with the expected world ID. A validation or persistence failure prevents host construction instead of exposing a partially initialized application. The production server trace explicitly includes the bundled runtime files.

The bundled set initially contains `worlds/blackmarsh/world/`. Reopening an existing database performs no bundled-world writes. Application updates do not silently replace an installed catalog version, and deleting Blackmarsh after installation remains effective. A future decision may add an explicit, user-visible bundled-content update policy without changing instance content-hash pinning.

This decision supersedes [0045](0045-versioned-reference-world-projects.md). Its author-project boundary, strict runtime layout, Blackmarsh content contract, attribution requirements, and content regression coverage remain in force; only the explicit-installation policy changes.

## Pros and Cons of the Options

### Manual installation

- Good: startup never mutates the world catalog implicitly.
- Bad: every fresh data root begins empty and requires players to perform a packaging workflow for content shipped with the application.

### Startup reconciliation

- Good: every launch exposes the latest bundled content automatically.
- Bad: deletion is not durable, startup can overwrite the player's selected catalog version, and repository content becomes a continuing catalog authority.

### Fresh-database seeding

- Good: the first-run experience is playable, the strict importer remains the single installation path, and established catalogs remain entirely player-controlled.
- Bad: bundled-content updates are not automatic for an existing data root and require a separate explicit update policy.

## Links

- [0004](0004-game-first-principles.md) — world scripts own lore and mechanics.
- [0039](0039-pinned-world-runtime-contract.md) — instances pin an immutable world content hash.
- [0045](0045-versioned-reference-world-projects.md) — superseded installation policy and retained author-project boundary.
- [Reference world projects](../../worlds/README.md) — bundled content inventory and authoring layout.
