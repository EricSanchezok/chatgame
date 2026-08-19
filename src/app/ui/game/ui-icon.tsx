"use client";

// UiIcon: framework chrome icons driven by the script's assets.yaml `ui`
// slots. A script may override any fixed slot with its own file (svg/png);
// otherwise the framework fallback glyph map renders (single source of
// truth for the built-in glyphs — no per-component emoji litter).

import { api, type AssetManifest } from "../../lib/api";
import type { UiIconSlot } from "../../../script/schemas/assets";

/** Built-in glyph fallbacks per slot (used when the script declares none). */
export const UI_GLYPHS: Record<UiIconSlot, string> = {
  inventory: "🎒",
  character: "🧑",
  relations: "💞",
  tasks: "📜",
  map: "🗺️",
  log: "📋",
  save: "💾",
  audio_on: "🔊",
  audio_off: "🔇",
  close: "✕",
  send: "➤",
  warning: "⚠️",
  hp: "❤️",
  location: "📍",
  time: "🕐",
};

export function UiIcon({
  slot,
  scriptId,
  manifest,
  className,
  alt,
}: {
  slot: UiIconSlot;
  scriptId: string;
  manifest: AssetManifest | undefined;
  className?: string;
  alt?: string;
}) {
  const entry = manifest?.ui?.[slot];
  const src = entry?.file ? api.fileAsset(scriptId, entry.file) : "";
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? slot}
        aria-hidden={alt ? undefined : true}
        className={`${className ?? ""} shrink-0 object-contain`}
      />
    );
  }
  return (
    <span role="img" aria-label={alt ?? slot} className={`${className ?? ""} shrink-0 leading-none`}>
      {UI_GLYPHS[slot]}
    </span>
  );
}
