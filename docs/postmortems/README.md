# Postmortems

A postmortem records why a subtle, systemic, or costly bug reached a real user, merged change, or release, and which permanent guardrail prevents the same class of failure. It is not a [decision record](../decisions/README.md), feature specification, or one-line fix summary.

## When to write one

Write a postmortem when the mechanism is non-obvious, the escape reveals a gap in tests/tooling/conventions, and rediscovery would cost meaningful debugging time. The record explains what broke, the root cause, why every safety net missed it, and the durable guardrail.

## Format

New records use the next sequential `NNNN-short-title.md` identity, put `Artifact-Version: 1` below the title, and contain these sections in order:

1. `## Executive summary`
2. `## Summary`
3. `## Timeline`
4. `## Root cause`
5. `## Guardrails`

`## Guardrails` links at least one permanent repository test, gate, skill, AGENTS.md rule, or decision. A verbal follow-up does not close the incident loop.

The existing unversioned 0001–0034 series is content-grandfathered by the repo-seed manifest. These records keep their identities and original language. New versioned records continue at 0035.

## Index

- [0001 — Deno Action Regression](0001-deno-action-regression.md)
- [0002 — Script UI Activation Race](0002-script-ui-activation-race.md)
- [0003 — Console Layout Displaced Conversation](0003-console-layout-displaced-conversation.md)
- [0004 — Loopback Preview Blocked Client Runtime](0004-loopback-preview-blocked-client-runtime.md)
- [0005 — Native Carousel Scrollbar](0005-native-carousel-scrollbar.md)
- [0006 — Launcher Step Layout Jump](0006-launcher-step-layout-jump.md)
- [0007 — Cross-script Floating Resume](0007-cross-script-floating-resume.md)
- [0008 — Conversation Hierarchy Regressed Again](0008-conversation-hierarchy-regressed-again.md)
- [0009 — Workflow Script Contract Drift](0009-workflow-script-contract-drift.md)
- [0010 — Session World Identity Drift](0010-session-world-identity-drift.md)
- [0011 — Awaiting Player Lost Goal](0011-awaiting-player-lost-goal.md)
- [0012 — Modifier Source Namespace Collision](0012-modifier-source-namespace-collision.md)
- [0013 — File-host Concurrency Boundary](0013-file-host-concurrency-boundary.md)
- [0014 — WorldHost Bootstrap Lease Leak](0014-world-host-bootstrap-lease-leak.md)
- [0015 — Unused Provider Credentials Blocked Runtime](0015-unused-provider-credentials-blocked-runtime.md)
- [0016 — Runtime Identity Collision and Reconnect Loop](0016-runtime-identity-collision-and-reconnect-loop.md)
- [0017 — Assistant UI Visual Baseline Drift](0017-assistant-ui-visual-baseline-drift.md)
- [0018 — Focus Ring and Orb-card Collision](0018-focus-ring-and-orb-card-collision.md)
- [0019 — Game-management Unmounted Session](0019-game-management-unmounted-session.md)
- [0020 — World-detail Inverted Hierarchy](0020-world-detail-inverted-hierarchy.md)
- [0021 — Control and State Geometry Drift](0021-control-and-state-geometry-drift.md)
- [0022 — Settings Container and Modal Chrome Drift](0022-settings-container-and-modal-chrome-drift.md)
- [0023 — Composer Marker and CJK Bubble Collapse](0023-composer-marker-and-cjk-bubble-collapse.md)
- [0024 — State Lines and Settings Divider Accumulation](0024-state-lines-and-settings-divider-accumulation.md)
- [0025 — World Inspector Failure Blindness](0025-world-inspector-failure-blindness.md)
- [0026 — Canonical-local Observation Repair Loop](0026-canonical-local-observation-repair-loop.md)
- [0027 — Character-event Basis Repair Loop](0027-character-event-basis-repair-loop.md)
- [0028 — Inspector Diagnostic Overflow](0028-inspector-diagnostic-overflow.md)
- [0029 — Blackmarsh Monolithic-transition Repair Exhaustion](0029-blackmarsh-monolithic-transition-repair-exhaustion.md)
- [0030 — Inspector Reported Last-start Event](0030-inspector-reported-last-start-event.md)
- [0031 — Stale Next.js Dynamic-route Table](0031-stale-next-dynamic-route-table.md)
- [0032 — Instance Dashboard Replaced Conversation Core](0032-instance-dashboard-replaced-conversation-core.md)
- [0033 — Cross-platform Visual-baseline Drift](0033-cross-platform-visual-baseline-drift.md)
- [0034 — Hidden Control-overlay Accessibility Race](0034-hidden-control-overlay-a11y-race.md)
