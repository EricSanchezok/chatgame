"use client";

// UiIcon: framework chrome icons driven by the script's assets.yaml `ui`
// slots. A script may override any fixed slot with its own file (svg/png);
// otherwise the host's single Lucide fallback set renders.

import {
  Archive,
  Backpack,
  BookOpenText,
  CircleUserRound,
  Clock3,
  HeartPulse,
  ListChecks,
  Map,
  MapPin,
  Send,
  TriangleAlert,
  UsersRound,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react";
import { httpGamePort, type AssetManifest } from "../../lib/api";
import type { UiIconSlot } from "../../../script/schemas/assets";

const FALLBACKS: Record<UiIconSlot, LucideIcon> = {
  inventory: Backpack,
  character: CircleUserRound,
  relations: UsersRound,
  tasks: ListChecks,
  map: Map,
  log: BookOpenText,
  save: Archive,
  audio_on: Volume2,
  audio_off: VolumeX,
  close: X,
  send: Send,
  warning: TriangleAlert,
  hp: HeartPulse,
  location: MapPin,
  time: Clock3,
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
  const src = entry?.file ? httpGamePort.assetUrl(scriptId, entry.file) : "";
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
  const Icon = FALLBACKS[slot];
  return <Icon aria-hidden="true" className={className} />;
}
