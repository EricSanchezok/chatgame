export const EMBERFALL_STYLES = `
[data-emberfall] { box-sizing: border-box; color: var(--cg-text); font-family: var(--cg-font-ui, var(--cg-font)); }
[data-emberfall] *, [data-emberfall] *::before, [data-emberfall] *::after { box-sizing: inherit; }
.ef-panel { width: 100%; color: var(--cg-text); }
.ef-kicker { display: block; color: var(--cg-text-dim); font-family: var(--cg-font-mono); font-size: calc(.7rem * var(--cg-scale)); letter-spacing: .075em; }
.ef-entry { padding: .95rem 0; border-top: 1px solid color-mix(in srgb, var(--cg-border) 68%, transparent); }
.ef-entry:first-child { border-top: 0; }
.ef-entry p { margin: .28rem 0 0; max-width: 64ch; color: var(--cg-text-dim); line-height: 1.65; }
.ef-cross { width: 100%; height: auto; color: var(--cg-text-dim); }
.ef-cross path { fill: none; stroke: currentColor; stroke-width: 2; }
.ef-cross circle { fill: var(--cg-background); stroke: currentColor; stroke-width: 2; }
.ef-cross circle[data-active=true] { fill: var(--cg-selected); stroke: var(--cg-accent); }
.ef-cross text { fill: currentColor; font-family: var(--cg-font-ui, var(--cg-font)); font-size: .75rem; }
.ef-evidence { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 1.25rem; }
.ef-source { padding: .8rem 0; border-bottom: 1px solid var(--cg-border); }
.ef-source[data-found=true] { border-bottom-color: var(--cg-accent); }
.ef-link { color: var(--cg-text-dim); opacity: .3; }
.ef-link[data-linked=true] { color: var(--cg-accent); opacity: 1; }
.ef-conclusion { margin-top: 1.5rem; padding: 1rem 0 1rem 1rem; border-left: 2px solid var(--cg-warning); color: var(--cg-text-dim); }
@media (max-width: 760px) { .ef-evidence { grid-template-columns: 1fr; } .ef-link { display: none; } }
@media (prefers-reduced-motion: reduce) { [data-emberfall] * { transition: none !important; } }
@media (prefers-contrast: more) { .ef-cross, .ef-source, .ef-conclusion { color: var(--cg-text); } }
`;
