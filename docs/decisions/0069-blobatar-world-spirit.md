# Blobatar World Spirit

## Status
Accepted
Class: architecture

## Context and Problem Statement

The gameplay control orb needs a stable visual identity per world, ambient motion, state expressions, and pointer-directed gaze without becoming a second source of game truth. The prior timer-only orb provided little interaction feedback, while a bespoke animated character would create a new illustration and animation subsystem inside the browser layer.

Blobatar generates deterministic geometric characters from a string and provides an inline SVG React adapter with idle motion and expressions. Pointer gaze is not a public component property in Blobatar 2.5.0, but its motion stylesheet deliberately leaves the `transform` property on the `.mo-eyes` group available for composition.

## Decision Drivers

- A world has one stable visual spirit derived only from its public content hash.
- Components continue to consume the existing `--cg-*` color tokens.
- Motion respects both system and application reduced-motion preferences.
- Pointer tracking must not trigger React rendering on every frame.
- A third-party internal SVG seam must remain isolated, testable, and safe to remove.
- A dependency upgrade must not silently change existing worlds' visual identities.

## Considered Options

- Build and maintain a bespoke animated SVG character system.
- Use Blobatar only as a static avatar and omit pointer gaze.
- Vendor or fork Blobatar to add a public gaze API.
- Use the official Blobatar React adapter, exact-pin its generation, and isolate gaze composition in one browser component.

## Decision Outcome

Use exact versions `blobatar@2.5.0` and `@blobatar/react@2.5.0` behind the `WorldSpirit` adapter. The adapter seeds `name` with `world.contentHash`, passes existing theme variables as the head and eye palette, keeps the background transparent, and uses only non-tinting expressions so CSS variables never enter Blobatar's hexadecimal tint path.

Animated rendering remains inline SVG in every motion mode. `WorldSpirit` alone targets the `.mo-eyes` group and writes bounded pointer-gaze offsets as CSS variables. Fine-pointer gaze uses one passive listener and one animation-frame write; action hover and keyboard focus override the pointer target. Reduced motion clears gaze and stops all ambient loops while retaining the static pose and textual state.

The two Blobatar packages remain exact-pinned. A dependency upgrade requires revalidating deterministic identity, the `.mo-eyes` composition seam, expressions, forced colors, and reduced motion before changing either version. Product components do not import or query Blobatar internals directly.

## Pros and Cons of the Options

### Bespoke animated SVG

- Good: Complete control and no third-party internal selector.
- Bad: Duplicates deterministic character generation, expression design, animation, and accessibility work that is not core game-engine behavior.

### Static Blobatar

- Good: Uses only public package behavior and has the smallest integration surface.
- Bad: Misses the directed gaze and responsive character behavior that make the control feel alive.

### Vendored or forked Blobatar

- Good: Could expose gaze as a first-class API.
- Bad: Creates a permanent source and release maintenance burden for a small presentation extension.

### Exact-pinned adapter with isolated gaze

- Good: Reuses the official deterministic identity and expression system while containing the one private seam in a replaceable component.
- Good: Exact generation pinning prevents an ordinary install from changing existing world spirits.
- Bad: A future Blobatar upgrade requires an explicit compatibility audit instead of an automatic dependency bump.

## Links

- [Blobatar documentation](https://blobatar.dev/)
- [Blobatar 2.5.0 source](https://github.com/Alain00/blobatar/tree/v2.5.0)
- [0011 — Layout and Presentation Tokens](0011-layout-and-presentation-tokens.md)
- [0065 — Platform Visual Baselines and Deterministic Layout](0065-platform-visual-baselines-and-deterministic-layout.md)
