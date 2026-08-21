export const STARLIGHT_STYLES = `
[data-starlight] { box-sizing: border-box; color: var(--cg-text); font-family: var(--cg-font-ui, var(--cg-font)); }
[data-starlight] *, [data-starlight] *::before, [data-starlight] *::after { box-sizing: inherit; }
[data-starlight] button, [data-starlight] textarea, [data-starlight] input { font: inherit; }
[data-starlight] button { min-height: 44px; cursor: pointer; }
[data-starlight] button:disabled { cursor: wait; opacity: .58; }
[data-starlight] :focus-visible { outline: 3px solid var(--cg-focus); outline-offset: 3px; }
.sl-eyebrow { margin: 0; color: var(--cg-accent); font: 700 calc(.66rem * var(--cg-scale)) / 1.2 var(--cg-font-mono); letter-spacing: .1em; }
.sl-muted { color: var(--cg-text-dim); }
.sl-button { min-height: 44px; padding: .65rem .85rem; border: 1px solid color-mix(in srgb, var(--cg-border) 72%, transparent); border-radius: var(--cg-radius-chrome); color: var(--cg-text); background: transparent; transition: background var(--cg-motion-quick), border-color var(--cg-motion-quick); }
.sl-button:hover { background: var(--cg-selected); border-color: var(--cg-accent); }
.sl-button:active { transform: translateY(1px); }
.sl-button--primary { color: var(--cg-on-primary); background: var(--cg-primary); border-color: var(--cg-primary); font-weight: 760; }
.sl-launcher { min-height: min(78vh, 48rem); display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(18rem, .55fr); overflow: hidden; background: var(--cg-background); }
.sl-launcher-hero { position: relative; min-height: 29rem; }
.sl-launcher-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sl-launcher-hero > div { position: absolute; inset: auto 0 0; padding: clamp(1.25rem, 4vw, 3.5rem); background: color-mix(in srgb, var(--cg-background) 90%, transparent); backdrop-filter: blur(10px); }
.sl-launcher h1 { margin: .3rem 0; font-size: clamp(2.25rem, 5vw, 4.5rem); line-height: 1.02; }
.sl-launcher-actions { display: flex; flex-direction: column; justify-content: end; gap: .75rem; padding: clamp(1.2rem, 3vw, 2.5rem); background: var(--cg-surface); }
.sl-hud { width: min(100%, 73.75rem); min-height: 3.75rem; margin: 0 auto; display: flex; align-items: center; gap: clamp(1.25rem, 3vw, 2.6rem); padding-block: .52rem; background: transparent; }
.sl-hud-place { min-width: 13rem; display: grid; gap: .08rem; padding-left: .8rem; border-left: 2px solid var(--cg-primary); }
.sl-hud-place span,.sl-hud-place small,.sl-metric span { display: block; color: var(--cg-text-dim); font: 650 calc(.61rem * var(--cg-scale)) / 1.25 var(--cg-font-mono); letter-spacing: .055em; }
.sl-hud-place strong { display: block; margin: .08rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: calc(.82rem * var(--cg-scale)); }
.sl-metrics { min-width: 0; flex: 1; display: flex; justify-content: flex-end; gap: clamp(1.35rem, 3.5vw, 3rem); }
.sl-metric { min-width: 3.6rem; }
.sl-metric strong { display: block; margin-top: .18rem; font: 680 calc(.82rem * var(--cg-scale)) / 1 var(--cg-font-mono); }
.sl-chat-composer .cg-action-shortcuts button { display: flex; align-items: baseline; gap: .38rem; text-align: left; }
.sl-chat-composer .cg-action-shortcuts small { padding-left: .38rem; border-left: 1px solid color-mix(in srgb, var(--cg-border) 72%, transparent); color: var(--cg-text-dim); font-size: calc(.65rem * var(--cg-scale)); font-weight: 470; }
.sl-chat-composer form { border-color: color-mix(in srgb, var(--cg-primary) 32%, var(--cg-border)); }
.sl-chat-composer form .cg-button--primary { font-size: 1rem; }
.sl-preview { display: flex; flex-wrap: wrap; gap: .28rem .75rem; color: var(--cg-text-dim); font-size: calc(.75rem * var(--cg-scale)); }
.sl-preview strong { color: var(--cg-text); }
.sl-preview[data-executable='false'] strong { color: var(--cg-warning); }
.sl-preview > div { display: flex; flex-wrap: wrap; gap: .28rem .75rem; font-family: var(--cg-font-mono); }
.sl-toolbar button { width: auto; min-width: 2.5rem; padding-inline: .35rem; color: var(--cg-text-dim); font-size: .75rem; }
.sl-toolbar [aria-pressed='true'] { color: var(--cg-primary); background: transparent; }
.sl-panel { width: 100%; padding: .15rem 0 .5rem; color: var(--cg-text); }
.sl-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
.sl-panel h2,.sl-panel h3 { margin: .22rem 0; }
.sl-panel > button { display: block; width: 100%; margin-top: .65rem; }
.sl-pause h2 { margin-bottom: .45rem; }
.sl-pause__status { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .85rem 0 1rem; color: var(--cg-text-dim); border-bottom: 1px solid color-mix(in srgb, var(--cg-border) 66%, transparent); font-size: .78rem; }
.sl-pause__status strong { color: var(--cg-accent); font-family: var(--cg-font-mono); font-weight: 650; }
.sl-pause__utilities { display: flex; flex-wrap: wrap; gap: .35rem .75rem; padding: 1.1rem 0; }
.sl-pause__utilities .sl-button { min-height: 38px; padding: .35rem 0; border: 0; color: var(--cg-text-dim); }
.sl-pause__utilities .sl-button:hover { color: var(--cg-text); background: transparent; }
.sl-pause__exit { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: .65rem; margin-top: .3rem; }
.sl-ring { list-style: none; margin: 1.7rem 0; padding: 0; display: grid; grid-template-columns: repeat(4,1fr); gap: 0; border-top: 1px solid var(--cg-border); border-bottom: 1px solid var(--cg-border); }
.sl-ring li { position: relative; display: grid; gap: .25rem; min-height: 6.5rem; padding: 1rem .8rem; }
.sl-ring li + li { border-left: 1px solid var(--cg-border); }
.sl-ring li[aria-current='location']::after { content: ""; position: absolute; right: .8rem; bottom: .8rem; width: .42rem; height: .42rem; border-radius: 50%; background: var(--cg-primary); }
.sl-ring span { color: var(--cg-accent); font-family: var(--cg-font-mono); font-size: .72rem; }
.sl-task-sheet dl { display: grid; gap: .5rem; margin-top: 1.3rem; }
.sl-task-sheet dl div { display: flex; justify-content: space-between; gap: 1rem; padding-top: .65rem; border-top: 1px solid color-mix(in srgb, var(--cg-border) 66%, transparent); }
.sl-task-sheet dd { margin: 0; font-family: var(--cg-font-mono); }
.sl-log-list { display: grid; gap: 1rem; padding-inline-start: 1.25rem; }
.sl-log-list p { color: var(--cg-text-dim); line-height: 1.6; }
.sl-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.sl-loading { animation: sl-fade .3s ease both; }
@keyframes sl-fade { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 980px) {
  .sl-hud { align-items: flex-start; gap: .8rem; padding-block: .42rem; }
  .sl-hud-place { min-width: 8.5rem; }
  .sl-hud-place span { display: none; }
  .sl-metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .35rem .7rem; }
  .sl-metric:nth-last-child(1) { display: none; }
  .sl-launcher { grid-template-columns: 1fr; }
  .sl-launcher-hero { min-height: 25rem; }
  .sl-panel { min-width: 0; width: 100%; }
  .sl-ring { grid-template-columns: 1fr 1fr; }
  .sl-ring li:nth-child(3) { border-left: 0; border-top: 1px solid var(--cg-border); }
  .sl-ring li:nth-child(4) { border-top: 1px solid var(--cg-border); }
  .sl-chat-composer .cg-action-shortcuts small { display: none; }
  .sl-pause__exit { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .sl-hud-place { min-width: 7.5rem; }
  .sl-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .sl-pause__utilities { display: grid; grid-template-columns: 1fr; }
}
@media (max-height: 600px) and (orientation: landscape) {
  .sl-hud { min-height: 2.75rem; padding-block: .25rem; }
  .sl-hud-place span,.sl-hud-place small,.sl-metric span { display: none; }
  .sl-launcher { min-height: 34rem; }
}
@media (prefers-reduced-motion: reduce) { [data-starlight] *,[data-starlight] *::before,[data-starlight] *::after { animation: none !important; transition-duration: .01ms !important; } }
@media (prefers-contrast: more) { [data-starlight] { --cg-border-width: 2px; } .sl-button,.sl-ring { border-color: var(--cg-text); } .sl-muted,.sl-hud-place span,.sl-hud-place small,.sl-metric span { color: var(--cg-text); } }
`;
