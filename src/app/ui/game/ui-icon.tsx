"use client";

// UiIcon: framework chrome icons driven by the script's assets.yaml `ui`
// slots. A script may override any fixed slot with its own file (svg/png);
// otherwise the framework fallback icon set renders (inline SVG, themed via
// currentColor — replaces the old emoji fallback table).

import { api, type AssetManifest } from "../../lib/api";
import type { UiIconSlot } from "../../../script/schemas/assets";
import { FallbackIcon } from "./icons";

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
  return <FallbackIcon slot={slot as FallbackIconSlot} className={className} />;
}

/** Maps UiIconSlot onto the fallback icon set (same key space). */
type FallbackIconSlot =
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
  | "time";
