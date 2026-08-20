export const STARLIGHT_STYLES = `
[data-starlight] {
  box-sizing: border-box;
  color: var(--cg-text);
  background: var(--cg-background);
  font-family: var(--cg-font-ui, var(--cg-font));
  letter-spacing: var(--cg-letter-spacing);
}
[data-starlight] *, [data-starlight] *::before, [data-starlight] *::after { box-sizing: inherit; }
[data-starlight] button, [data-starlight] input, [data-starlight] textarea, [data-starlight] select { font: inherit; }
[data-starlight] button, [data-starlight] select { min-height: 44px; }
[data-starlight] button { cursor: pointer; }
[data-starlight] button:disabled { cursor: wait; opacity: .62; }
[data-starlight] button:focus-visible, [data-starlight] input:focus-visible, [data-starlight] textarea:focus-visible, [data-starlight] select:focus-visible {
  outline: 3px solid var(--cg-focus);
  outline-offset: 2px;
}
.sl-shell { min-height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: var(--cg-space-2); padding: var(--cg-space-2); overflow: hidden; }
.sl-workspace { min-height: 0; display: grid; grid-template-columns: minmax(13rem, .72fr) minmax(20rem, 1.6fr) minmax(20rem, 1.08fr); gap: var(--cg-space-2); }
.sl-metal { background: var(--cg-surface); border: var(--cg-border-width) solid var(--cg-border); border-radius: var(--cg-radius-chrome); }
.sl-paper { background: var(--cg-text); color: var(--cg-background); border-radius: var(--cg-radius-chrome); }
.sl-eyebrow { margin: 0; color: var(--cg-accent); font: 700 calc(.68rem * var(--cg-scale)) / 1.2 var(--cg-font-mono); letter-spacing: .12em; text-transform: uppercase; }
.sl-label { color: var(--cg-text-dim); font: 700 calc(.66rem * var(--cg-scale)) / 1.2 var(--cg-font-mono); letter-spacing: .08em; text-transform: uppercase; }
.sl-mono { font-family: var(--cg-font-mono); font-variant-numeric: tabular-nums; }
.sl-hud { display: grid; grid-template-columns: minmax(10rem, 1.2fr) repeat(5, minmax(6.2rem, .72fr)); min-width: 0; overflow-x: auto; }
.sl-brand, .sl-meter { min-width: 0; padding: var(--cg-space-2) var(--cg-space-3); border-inline-end: var(--cg-border-width) solid var(--cg-border); }
.sl-meter:last-child { border-inline-end: 0; }
.sl-brand strong { display: block; margin-top: .2rem; font-size: calc(1.08rem * var(--cg-scale)); }
.sl-meter-line { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; margin-top: .35rem; }
.sl-meter-value { color: var(--cg-text); font: 700 calc(1.02rem * var(--cg-scale)) / 1 var(--cg-font-mono); }
.sl-track { height: 5px; margin-top: .45rem; background: var(--cg-background); overflow: hidden; }
.sl-fill { height: 100%; background: var(--cg-accent); }
.sl-fill--warning { background: var(--cg-warning); }
.sl-fill--danger { background: var(--cg-danger); }
.sl-section { min-height: 0; padding: var(--cg-space-3); overflow: auto; }
.sl-section h2, .sl-section h3 { margin: 0; font-weight: 700; }
.sl-station-list { list-style: none; margin: var(--cg-space-3) 0 0; padding: 0; display: grid; gap: var(--cg-space-2); }
.sl-zone { position: relative; display: grid; grid-template-columns: 2rem 1fr; gap: .55rem; min-height: 4rem; padding: .6rem; border: var(--cg-border-width) solid var(--cg-border); color: var(--cg-text-dim); }
.sl-zone[data-current='true'] { border-color: var(--cg-primary); background: var(--cg-selected); color: var(--cg-text); }
.sl-zone-mark { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; color: var(--cg-accent); }
.sl-zone[data-current='true'] .sl-zone-mark { color: var(--cg-primary); }
.sl-zone strong { display: block; color: var(--cg-text); }
.sl-zone small { display: block; margin-top: .18rem; }
.sl-allocation { margin-top: var(--cg-space-3); padding-top: var(--cg-space-3); border-top: var(--cg-border-width) solid var(--cg-border); }
.sl-allocation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-top: .6rem; }
.sl-count { padding: .55rem; background: var(--cg-surface-alt); }
.sl-count strong { display: block; font: 700 calc(1.1rem * var(--cg-scale)) / 1 var(--cg-font-mono); }
.sl-count[data-excluded='true'] strong { color: var(--cg-danger); }
.sl-scene { min-height: 0; display: grid; grid-template-rows: minmax(9rem, 31%) minmax(0, 1fr); overflow: hidden; }
.sl-scene-figure { position: relative; margin: 0; min-height: 0; overflow: hidden; border-bottom: var(--cg-border-width) solid var(--cg-border); }
.sl-scene-figure img { width: 100%; height: 100%; min-height: 9rem; object-fit: cover; filter: saturate(.72) contrast(1.02); }
.sl-scene-figure figcaption { position: absolute; inset: auto .5rem .5rem .5rem; padding: .45rem .6rem; background: var(--cg-background); border: var(--cg-border-width) solid var(--cg-primary); color: var(--cg-text); }
.sl-log { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--cg-text); color: var(--cg-background); }
.sl-log-head { display: flex; justify-content: space-between; gap: 1rem; padding: .75rem 1rem; border-bottom: 1px dashed var(--cg-border); }
.sl-log-scroll { min-height: 0; overflow: auto; padding: .35rem 1rem 1rem; scrollbar-gutter: stable; }
.sl-log-row { display: grid; grid-template-columns: 5.4rem minmax(6rem, .65fr) 1fr; gap: .7rem; padding: .55rem 0; border-bottom: 1px dashed var(--cg-border); font-size: calc(.78rem * var(--cg-scale)); }
.sl-channel { font: 700 calc(.68rem * var(--cg-scale)) / 1.3 var(--cg-font-mono); }
.sl-channel[data-alarm='true'] { color: var(--cg-danger); }
.sl-transcript { padding-top: .5rem; }
.sl-bubble { margin: 0; padding: .65rem 0; border-bottom: 1px dashed var(--cg-border); color: var(--cg-background); }
.sl-bubble[data-role='player'] { padding-inline: 1rem; background: color-mix(in srgb, var(--cg-primary) 12%, transparent); }
.sl-bubble[data-role='system'] { font-family: var(--cg-font-mono); }
.sl-card { margin: .45rem 0; padding: .55rem .65rem; border: var(--cg-border-width) solid var(--cg-warning); background: var(--cg-surface-alt); color: var(--cg-text); }
.sl-composer { min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: var(--cg-space-2); padding: var(--cg-space-3); overflow: auto; }
.sl-work-order { padding: var(--cg-space-3); }
.sl-work-order h2 { color: var(--cg-background); font-size: calc(1.1rem * var(--cg-scale)); }
.sl-facts { margin: .75rem 0 0; padding-inline-start: 1.2rem; font-size: calc(.78rem * var(--cg-scale)); }
.sl-solutions { display: grid; gap: .5rem; }
.sl-solution { width: 100%; padding: .65rem .7rem; text-align: start; color: var(--cg-text); background: var(--cg-surface-alt); border: var(--cg-border-width) solid var(--cg-border); border-radius: var(--cg-radius-chrome); transition: transform var(--cg-motion-quick), border-color var(--cg-motion-quick), background var(--cg-motion-quick); }
.sl-solution:hover { transform: translateY(-1px); border-color: var(--cg-accent); }
.sl-solution:active { transform: translateY(1px); }
.sl-solution[aria-pressed='true'] { border-color: var(--cg-primary); background: var(--cg-selected); }
.sl-solution strong { display: block; }
.sl-solution small { display: block; margin-top: .22rem; color: var(--cg-text-dim); }
.sl-preview { padding: .75rem; border: var(--cg-border-width) solid var(--cg-accent); background: var(--cg-background); }
.sl-preview[data-executable='false'] { border-color: var(--cg-danger); }
.sl-costs { display: flex; flex-wrap: wrap; gap: .45rem .8rem; margin-top: .45rem; color: var(--cg-text-dim); font: 700 calc(.72rem * var(--cg-scale)) / 1.35 var(--cg-font-mono); }
.sl-actions { display: grid; grid-template-columns: 1fr 1fr; gap: .55rem; }
.sl-button { min-height: 44px; padding: .6rem .8rem; border: var(--cg-border-width) solid var(--cg-border); border-radius: var(--cg-radius-chrome); color: var(--cg-text); background: var(--cg-surface-alt); transition: transform var(--cg-motion-quick), background var(--cg-motion-quick); }
.sl-button:hover { background: var(--cg-selected); }
.sl-button:active { transform: translateY(1px); }
.sl-button--primary { color: var(--cg-on-primary); background: var(--cg-primary); border-color: var(--cg-primary); font-weight: 800; }
.sl-radio { display: grid; grid-template-columns: minmax(7rem, .32fr) 1fr auto; gap: .5rem; }
.sl-radio select, .sl-radio textarea { width: 100%; color: var(--cg-text); background: var(--cg-background); border: var(--cg-border-width) solid var(--cg-border); border-radius: var(--cg-radius-chrome); padding: .65rem; }
.sl-radio textarea { min-height: 52px; resize: vertical; }
.sl-toolbar { display: flex; gap: .5rem; padding: .45rem; overflow-x: auto; }
.sl-toolbar .sl-button { flex: 0 0 auto; }
.sl-panel { min-width: min(34rem, 90vw); max-height: 70vh; overflow: auto; padding: var(--cg-space-3); }
.sl-panel-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.sl-ring { width: 100%; max-height: 22rem; color: var(--cg-border); }
.sl-ring .active { color: var(--cg-primary); }
.sl-launcher { min-height: min(78vh, 48rem); display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(18rem, .6fr); overflow: hidden; }
.sl-launcher-hero { position: relative; min-height: 28rem; }
.sl-launcher-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sl-launcher-copy { position: absolute; inset: auto 0 0; padding: clamp(1.2rem, 4vw, 3.5rem); background: color-mix(in srgb, var(--cg-background) 88%, transparent); }
.sl-launcher-copy h1 { margin: .3rem 0; font-size: clamp(2rem, 6vw, 3.75rem); line-height: .95; }
.sl-launcher-actions { display: flex; flex-direction: column; justify-content: end; gap: .7rem; padding: clamp(1rem, 3vw, 2.5rem); }
.sl-loading { animation: sl-pulse 1.3s ease-in-out infinite alternate; }
@keyframes sl-pulse { from { opacity: .62; } to { opacity: 1; } }
@media (max-width: 980px) {
  .sl-shell { overflow: auto; }
  .sl-workspace { grid-template-columns: minmax(12rem, .7fr) minmax(0, 1.3fr); }
  .sl-composer { grid-column: 1 / -1; }
}
@media (max-width: 720px) {
  .sl-shell { display: block; padding: .45rem; }
  .sl-shell > * + * { margin-top: .45rem; }
  .sl-hud { grid-template-columns: minmax(9.5rem, 1.3fr) repeat(5, minmax(5.7rem, .7fr)); }
  .sl-workspace { display: flex; flex-direction: column; }
  .sl-workspace > .sl-composer { order: 1; }
  .sl-workspace > .sl-section { order: 2; }
  .sl-workspace > .sl-scene { order: 3; min-height: 32rem; }
  .sl-radio { grid-template-columns: 1fr; }
  .sl-radio .sl-button { width: 100%; }
  .sl-launcher { grid-template-columns: 1fr; }
  .sl-launcher-hero { min-height: 26rem; }
}
@media (max-height: 600px) and (orientation: landscape) {
  .sl-shell { overflow: auto; }
  .sl-workspace { min-height: 34rem; grid-template-columns: 12rem minmax(20rem, 1fr) minmax(20rem, 1fr); }
  .sl-hud { position: static; }
}
@media (prefers-reduced-motion: reduce) {
  [data-starlight] *, [data-starlight] *::before, [data-starlight] *::after { animation: none !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  .sl-solution:hover { transform: none; }
}
@media (prefers-contrast: more) {
  [data-starlight] { --cg-border-width: 2px; }
  .sl-metal, .sl-button, .sl-solution, .sl-radio select, .sl-radio textarea { border-color: var(--cg-text); }
  .sl-label, .sl-solution small { color: var(--cg-text); }
}
`;
