# Conversation Timeline Rail and Stateful Composer

## Status
Accepted
Class: feature

## Context and Problem Statement

World sessions combine submit-ready actions, long-running WorldRuns, pause/resume, reaction windows, and read-only Observer views. Keeping the composer visible in every state makes a non-submittable page look actionable, while long conversations lack lightweight navigation between historical world boundaries.

## Decision Drivers

- When submission is unavailable, remove the composer from the interaction surface instead of only disabling its send button.
- Participant, Observer, paused, and reaction-window states must share one message axis.
- Desktop needs historical positioning without a permanent information sidebar or a second scroll axis.
- The rail may consume only existing public projections; it must not expose canonical truth or another subject's cognition.
- 320px mobile layouts, keyboards, reduced motion, forced colors, and RTL must remain usable.

## Considered Options

- Always show a disabled composer and place run status inside it.
- Add a permanent right information sidebar for progress and world state.
- Use a stateful composer and an independent desktop message-timeline rail — the selected option.

## Decision Outcome

The Participant composer mounts only when the current Participant can submit a natural-language action. `queued`, `running`, `pausing`, and submission-in-flight states use a compact run-status bar; `paused`, `budget-paused`, `preparation-invalidated`, `awaiting-decision`, and an unsubmitted reaction window keep input available. Observers never mount a composer.

The desktop game page uses a fixed message-timeline rail. It derives ticks from world replies in the current permission projection and shows a lightweight preview card for the active tick; clicking a tick only scrolls the existing session viewport and never changes world state. The rail does not replace the native scrollbar or display canonical identities, hidden checks, or another Agent's private information. Mobile hides the rail and retains the in-session scroll-to-latest control.

The game shell remains an immersive single-axis layout without a sidebar. World name, current location, world time, and step appear as lightweight context at the canvas edge; saves, settings, perspective, control transfer, and Inspector remain available through the control orb.

## Pros and Cons of the Options

### Always show a disabled composer

- Good: stable bottom height and a permanently visible input affordance.
- Bad: presents a false affordance when submission is unavailable and consumes space needed for long-form reading.

### Permanent right information sidebar

- Good: status information remains continuously visible.
- Bad: compresses the message axis, introduces a second layout and scrolling semantic, and requires another drawer behavior on mobile.

### Stateful composer and message-timeline rail

- Good: interaction state matches its visual affordance, historical navigation preserves the single-axis session, and the rail uses existing projections only.
- Bad: mounting and unmounting the composer changes the bottom height, while the rail must maintain viewport observation and narrow-screen degradation.

## Links

- [0064](0064-conversation-core-and-agent-perspective-observer.md) — Unified Participant and Observer session projections.
- [0070](0070-event-boundary-temporal-runtime.md) — WorldRun, pause, and reaction-window boundaries.
- [Presentation specification](../game-design/presentation.md) — Current game-session and permission boundaries.
