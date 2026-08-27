# Use precommitted semantic resolution plans and deterministic effect bands

## Status
Accepted
Class: architecture

## Context and Problem Statement

Open facts and precommitted d20 checks preserve narrative freedom, but `core-d20@1.1.0` still lets a model choose a raw Meter amount after seeing a check result. The kernel can prove that the amount reaches the declared recipient, but not that a club, sword, flaming sword, armor, or improvised handful of sand justifies that amount. Adding Weapon and Armor classes would make combat precise by narrowing the engine to one genre and would still leave social, environmental, economic, and progress effects without a common magnitude contract.

## Decision Drivers

- Preserve arbitrary natural-language actions and script-driven genres.
- Commit semantic and numeric stakes before randomness is revealed.
- Derive every runtime number from named script data, existing state, committed randomness, explicit player quantities, or trusted code.
- Let unanticipated objects and environmental affordances matter without requiring authors to enumerate them.
- Give authors deterministic overrides for iconic mechanics without allowing executable world archives.
- Keep one settlement path that is replayable, causally auditable, and cognitively isolated.
- Keep the core vocabulary small enough for model schemas, authors, players, and tests to share.

## Considered Options

- Add fixed Weapon, Armor, damage-type, accuracy, defense, and resistance schemas.
- Let Truth continue choosing raw DCs, modifiers, and Meter deltas under semantic verification.
- Require every mechanically relevant Fact and Entity to carry authored numeric annotations.
- Use open semantic planning, fixed named bands, optional author overrides, and trusted deterministic settlement.

## Decision Outcome

Living World Engine uses a precommitted `ResolutionPlan` between action grounding and resolution randomness. The plan fixes grounded means, canonical factor evidence, named difficulty or opposition, risk, magnitude, intended effects, and threatened effects. A fixed five-band magnitude and four-grade d20 outcome grammar converts the accepted plan into trusted operations. The model chooses semantic bands and effect descriptions; the kernel owns exact DC derivation, advantage mode, outcome grade, impact curves, combination limits, clamping, provenance, and atomic writes.

`ConditionState` is the open semantic representation for transient mechanically relevant state. It shares magnitude bands with Meter impacts but does not require a global condition taxonomy. Scripts may declare profiles for deterministic stacking, recurrence, recovery, and thresholds. Entity identity remains persistence-driven: a one-step improvised means can be grounded from canonical environment evidence, while an independently persistent or transferable object is an ordinary Entity rather than a Weapon subclass.

`core-resolution@2.0.0` is the single default settlement package. It rejects model-authored numeric operations and derives them from plans, profiles, explicit quantities, existing state, committed random results, or trusted rules. `ResolutionReceipt` becomes persisted replay and observability evidence. Schema v10 rejects v9 worlds and states without migration or a compatibility path.

The decision supersedes [0032](0032-open-world-facts-and-d20-kernel.md) where that record permits numeric Fact modifiers and post-check model-selected Meter amounts. It retains open Facts, script-defined Meter/Quantity/Rating primitives, precommitted randomness, and trusted versioned server rule packages.

## Pros and Cons of the Options

### Fixed combat object schemas

- Good: conventional tactical statistics are easy to calculate and display.
- Bad: the core privileges combat and known equipment, cannot price improvised semantics, and expands with every genre-specific interaction.

### Model-authored raw numbers

- Good: minimal schema and maximum immediate flexibility.
- Bad: equivalent semantics drift across calls and models, post-roll amounts are not meaningfully precommitted, and causal verification cannot reconstruct a unique calculation.

### Mandatory authored annotations

- Good: deterministic results for every annotated interaction.
- Bad: arbitrary player improvisation becomes mechanically inert, world authoring cost grows without bound, and missing annotations become hidden action restrictions.

### Semantic plans with deterministic bands

- Good: arbitrary semantics remain playable while numeric settlement, combination, replay, and visibility use one strict contract; authors can override important content without annotating everything.
- Bad: legal band selection still depends on model quality, requires calibration examples and an independent verifier, and adds plan and receipt records to every uncertain action.

## Links

- [Approved open semantic resolution v10 Spec](../specs/0001-open-semantic-resolution-v10.md)
- [0004 — Game-first principles](0004-game-first-principles.md)
- [0042 — Causal assurance and staged model profiles](0042-causal-assurance-and-staged-model-profiles.md)
- [0046 — Committed discrete random distributions](0046-committed-discrete-random-distributions.md)
- [Blades in the Dark effect and position](https://bladesinthedark.com/effect)
- [Fate Core stress and consequences](https://fate-srd.com/fate-core/stress-consequences)
- [Cortex Prime core rules](https://www.cortexrpg.com/compendium/explore-the-rules)
- [City of Mist tags and statuses](https://sonofoak.com/en-gb/blogs/news/tags-and-statuses-in-city-of-mist-ttrpg)
- [Concordia grounded generative environments](https://deepmind.google/research/publications/64717/)
