export const EMBERFALL_STYLES = `
[data-emberfall] { box-sizing: border-box; color: var(--cg-text); font-family: var(--cg-font-ui, var(--cg-font)); }
[data-emberfall] *, [data-emberfall] *::before, [data-emberfall] *::after { box-sizing: inherit; }
[data-emberfall] button, [data-emberfall] textarea, [data-emberfall] input { font: inherit; }
[data-emberfall] :focus-visible { outline: 3px solid var(--cg-focus); outline-offset: 3px; }
.ef-hud,.ef-panel { color: var(--cg-text); font-family: var(--cg-font-ui, var(--cg-font)); }
.ef-hud { width: min(100%, 73.75rem); min-height: 3.75rem; margin: 0 auto; display: flex; align-items: center; gap: clamp(1.25rem, 3vw, 2.5rem); padding-block: .55rem; background: transparent; }
.ef-brand { min-width: 12rem; display: grid; gap: .1rem; padding-left: .8rem; border-left: 2px solid var(--cg-accent); }
.ef-brand strong { font-size: calc(.92rem * var(--cg-scale)); letter-spacing: .035em; }
.ef-brand small { color: var(--cg-text-dim); font-size: calc(.68rem * var(--cg-scale)); }
.ef-readouts { min-width: 0; flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: clamp(1.2rem, 3vw, 2.6rem); }
.ef-readout { min-width: 0; display: grid; gap: .18rem; }
.ef-readout--place { flex: 1; max-width: 17rem; }
.ef-label,.ef-kicker { display: block; color: var(--cg-text-dim); font-family: var(--cg-font-mono); font-size: calc(.62rem * var(--cg-scale)); letter-spacing: .075em; }
.ef-value { display: block; overflow: hidden; color: var(--cg-text); text-overflow: ellipsis; white-space: nowrap; font-size: calc(.78rem * var(--cg-scale)); font-variant-numeric: tabular-nums; }
.ef-reading { display: flex; align-items: center; gap: .55rem; }
.ef-reading .ef-value { min-width: 3.3rem; font-family: var(--cg-font-mono); font-size: calc(.8rem * var(--cg-scale)); }
.ef-meter { width: clamp(2.7rem, 5vw, 4.8rem); height: 1px; background: color-mix(in srgb, var(--cg-border) 72%, transparent); overflow: visible; }
.ef-meter span { display: block; height: 2px; transform: translateY(-.5px); background: var(--cg-accent); }
.ef-meter[data-warning=true] span { background: var(--cg-warning); }
.ef-chat-composer .cg-action-shortcuts button { display: flex; align-items: baseline; gap: .38rem; text-align: left; }
.ef-chat-composer .cg-action-shortcuts small { padding-left: .38rem; border-left: 1px solid color-mix(in srgb, var(--cg-border) 72%, transparent); color: var(--cg-text-dim); font-size: calc(.65rem * var(--cg-scale)); font-weight: 470; }
.ef-chat-composer .cg-action-preview { min-height: 1.2rem; }
.ef-chat-composer form { border-color: color-mix(in srgb, var(--cg-accent) 32%, var(--cg-border)); }
.ef-chat-composer form .cg-button--primary { font-size: 1rem; }
.ef-chat-toolbar button { width: auto; min-width: 2.5rem; padding-inline: .35rem; color: var(--cg-text-dim); font-size: .75rem; }
.ef-chat-toolbar [aria-pressed=true] { color: var(--cg-accent); background: transparent; }
.ef-panel { width: 100%; padding: .15rem 0 .5rem; }
.ef-panel h2 { margin: .25rem 0 1.5rem; font-size: calc(1.45rem * var(--cg-scale)); font-weight: 650; }
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
.ef-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 760px) {
  .ef-hud { align-items: flex-start; gap: .8rem; padding-block: .45rem; }
  .ef-brand { min-width: 7.6rem; }
  .ef-readouts { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .4rem .8rem; }
  .ef-readout--place { display: none; }
  .ef-reading { display: block; }
  .ef-meter { display: none; }
  .ef-panel { width: 100%; }
  .ef-evidence { grid-template-columns: 1fr; }
  .ef-link { display: none; }
  .ef-chat-composer .cg-action-shortcuts small { display: none; }
}
@media (max-height: 540px) and (orientation: landscape) {
  .ef-hud { min-height: 2.75rem; padding-block: .25rem; }
  .ef-brand small,.ef-label { display: none; }
}
@media (prefers-reduced-motion: reduce) { .ef-chat-composer * { transition: none !important; } }
`;
