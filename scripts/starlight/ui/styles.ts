export const STARLIGHT_STYLES = `
[data-starlight] { box-sizing: border-box; color: var(--cg-text); font-family: var(--cg-font-ui, var(--cg-font)); }
[data-starlight] *, [data-starlight] *::before, [data-starlight] *::after { box-sizing: inherit; }
.sl-panel { width: 100%; color: var(--cg-text); }
.sl-ring { list-style: none; margin: .25rem 0; padding: 0; display: grid; grid-template-columns: repeat(4,1fr); border: 1px solid var(--cg-border); border-radius: var(--cg-radius); overflow: hidden; }
.sl-ring li { position: relative; display: grid; gap: .25rem; min-height: 6.5rem; padding: 1rem .8rem; }
.sl-ring li + li { border-left: 1px solid var(--cg-border); }
.sl-ring li[aria-current='location'] { background: var(--cg-selected); }
.sl-ring li[aria-current='location']::after { content: ""; position: absolute; right: .8rem; bottom: .8rem; width: .42rem; height: .42rem; border-radius: 50%; background: var(--cg-primary); }
.sl-ring span { color: var(--cg-accent); font-family: var(--cg-font-mono); font-size: calc(.72rem * var(--cg-scale)); }
.sl-task-sheet h3 { margin: 0 0 .35rem; }
.sl-task-sheet > p, .sl-log-list p { color: var(--cg-text-dim); line-height: 1.6; }
.sl-task-sheet > button { margin-top: 1rem; }
.sl-task-sheet dl { display: grid; gap: .5rem; margin-top: 1.3rem; }
.sl-task-sheet dl div { display: flex; justify-content: space-between; gap: 1rem; padding-top: .65rem; border-top: 1px solid color-mix(in srgb, var(--cg-border) 66%, transparent); }
.sl-task-sheet dd { margin: 0; font-family: var(--cg-font-mono); }
.sl-log-list { display: grid; gap: 1rem; margin: 0; padding-inline-start: 1.25rem; }
.sl-log-list p { margin: .25rem 0 0; }
@media (max-width: 720px) { .sl-ring { grid-template-columns: 1fr 1fr; } .sl-ring li:nth-child(3) { border-left: 0; border-top: 1px solid var(--cg-border); } .sl-ring li:nth-child(4) { border-top: 1px solid var(--cg-border); } }
@media (prefers-reduced-motion: reduce) { [data-starlight] * { transition: none !important; } }
@media (prefers-contrast: more) { .sl-ring, .sl-ring li { border-color: var(--cg-text); } }
`;
