"use client";

// Framework fallback icon set: inline SVG glyphs per UI slot, used when the
// script's assets.yaml declares no file for the slot. Replaces the old
// emoji fallback table (UI_GLYPHS) — deterministic, theme-colored via
// currentColor, and dependency-free. Script assets still win when present.

/** All framework chrome icon slots (must match assets.yaml `ui` slots). */
export type IconSlot =
  | "inventory"
  | "character"
  | "relations"
  | "tasks"
  | "map"
  | "log"
  | "save"
  | "audio_on"
  | "audio_off"
  | "close"
  | "send"
  | "warning"
  | "hp"
  | "location"
  | "time"
  | "menu";

const PATHS: Record<IconSlot, React.ReactNode> = {
  inventory: (
    <>
      <path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </>
  ),
  character: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
  relations: (
    <>
      <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 7a5 5 0 0 1 9.5 5C19 16.5 12 21 12 21z" />
      <circle cx="12" cy="10" r="1.4" />
    </>
  ),
  tasks: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </>
  ),
  map: (
    <>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  log: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M8 3v6h8V3M8 21v-7h8v7" />
    </>
  ),
  audio_on: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  audio_off: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 9l5 6M22 9l-5 6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  send: <path d="M3 11l18-8-8 18-2.5-7.5L3 11z" />,
  warning: (
    <>
      <path d="M12 3L2 20h20L12 3z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  hp: (
    <>
      <path d="M12 20s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5C19 15.5 12 20 12 20z" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

/** Renders the framework fallback icon for a slot (stroke = currentColor). */
export function FallbackIcon({ slot, className }: { slot: IconSlot; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${className ?? ""} shrink-0`}
    >
      {PATHS[slot]}
    </svg>
  );
}
