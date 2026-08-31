# Bundled Model-profile Snapshot Drift
Artifact-Version: 1

## Executive summary

Changing the bundled world's model-profile references did not affect newly created instances while the local data root still contained an older persisted world catalog. The server imported bundled worlds only when the database was first created, and each instance pinned its own runtime contract and model catalog snapshot. A GLM request then reached the provider and failed with `Prompt exceeds max length`, while an attempted Qwen run exposed the same context-boundary risk. The permanent fix is an explicit profile-switch checklist that validates source files, refreshes the data root or uses an intentional replacement import, verifies credentials and transport with one call, and inspects a newly created instance before a full run.

## Summary

The local development workflow selected a different provider in the source world files, but the running data root retained the old Blackmarsh catalog and instances. The Inspector correctly reported the pinned GLM provider, which looked like a failed model switch until the persisted snapshot boundary was identified. The first physical-interface transport implementation also placed Undici's `localAddress` under `connect`, so the request continued to follow the VPN TUN route until the account transport was corrected.

## Timeline

1. The bundled world references were changed from GLM Coding Plan to the campus Qwen profiles.
2. A clean-looking new instance was created from the existing data root and still pinned `zhipuai-coding-plan / glm-5.3-flash`.
3. Its action-compilation request was about 7.9 MB and the provider returned HTTP 400 `Prompt exceeds max length`; no structured-output or semantic repair was possible.
4. The Qwen account was tested with a physical-interface address. The initial Undici option shape did not bind the socket; using the top-level `localAddress` option made the direct call succeed.
5. The old instance and catalog were removed from the test data root, the server was restarted, and the bundled world was imported from the current source files.

## Root cause

The model profile is part of the versioned world runtime contract rather than a live pointer to `config/models.yaml`. `installBundledWorlds` intentionally imports bundled assets only for a newly created database, and recovery reuses the instance's pinned contract. Source edits, a server restart, or deleting only an instance therefore cannot refresh an already persisted world catalog. Separately, provider context limits are enforced by the remote endpoint; local byte limits and model output budgets must leave headroom for the selected model's actual token ceiling. Network workarounds are account-scoped and depend on the exact Undici option shape.

## Guardrails

- [AGENTS.md](../../AGENTS.md) requires a fresh or explicitly replaced data root and a new-instance Inspector check whenever bundled model profiles change.
- [Development profile-switch checklist](../development.md#switching-model-profiles) requires source validation, `models:status`, a single-account live transport smoke, provider context-budget review, and a clean server restart.
- [Account-scoped network decision](../decisions/0084-account-scoped-node-network-binding.md) records the top-level `localAddress` transport contract and keeps VPN bypass opt-in per account.
- [World runtime contract decision](../decisions/0039-pinned-world-runtime-contract.md) defines why existing instances are not mutated when deployment profiles change.
