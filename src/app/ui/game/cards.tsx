"use client";

// Inline message cards: rendered inside the chat stream, driven by
// resolution + mediaCues. Every card degrades gracefully — no portrait
// -> initial-letter avatar, no background -> solid color card.

import { useState } from "react";
import type { AssetManifest, Catalog, MediaCue, TranscriptEntry, WorldState } from "../../lib/api";
import { httpGamePort } from "../../lib/api";
import { UiIcon } from "./ui-icon";
import { SlotRenderer } from "./slots";
import type { MessageCardSlotProps } from "../../lib/script-registry";
import { Dialog } from "../dialog";

export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="cg-media-open" onClick={() => setOpen(true)} aria-label={`查看原图：${alt}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- script media is runtime-addressed. */}
        <img src={src} alt={alt} />
      </button>
      {open ? (
        <Dialog title={alt} onClose={() => setOpen(false)} className="cg-lightbox-dialog">
          {/* eslint-disable-next-line @next/next/no-img-element -- script media is runtime-addressed. */}
          <img className="cg-lightbox-image" src={src} alt={alt} />
        </Dialog>
      ) : null}
    </>
  );
}

/** Resolution grade -> display label. */
export function gradeLabel(grade: string): string {
  switch (grade) {
    case "crit":
      return "大成功";
    case "success":
      return "成功";
    case "partial":
      return "部分成功";
    case "fail":
      return "失败";
    default:
      return grade;
  }
}

/** Asset URL for an entity — file first, prompt fallback, "" when absent. */
export function assetSrc(
  scriptId: string,
  manifest: AssetManifest | undefined,
  kind: Exclude<keyof AssetManifest, "cover">,
  entityId: string,
): string {
  const entry = manifest?.[kind][entityId];
  if (!entry) return "";
  if (entry.file) return httpGamePort.assetUrl(scriptId, entry.file);
  if (entry.prompt) return httpGamePort.entityAssetUrl(scriptId, kind, entityId);
  return "";
}

/** Initial-letter avatar block (no portrait declared or load failure). */
export function AvatarFallback({ name, label }: { name: string; label?: string }) {
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
      style={{ background: "var(--cg-primary)", color: "var(--cg-surface)" }}
      aria-label={label ?? name}
    >
      {(name || "?").slice(0, 1)}
    </div>
  );
}

export function NpcCard({
  scriptId,
  npcId,
  npcName,
  relationLabel,
  manifest,
}: {
  scriptId: string;
  npcId: string;
  npcName: string;
  relationLabel?: string;
  manifest: AssetManifest | undefined;
}) {
  const src = assetSrc(scriptId, manifest, "portraits", npcId);
  return (
    <figure className="cg-npc-introduction">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={npcName}
          className="cg-npc-introduction__portrait"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
            (e.currentTarget.nextElementSibling as HTMLElement | null)?.classList.remove("hidden");
          }}
        />
      ) : null}
      {!src ? <AvatarFallback name={npcName} /> : null}
      <figcaption>
        <div className="cg-npc-introduction__name">{npcName}</div>
        {relationLabel ? (
          <div className="cg-npc-introduction__relation">{relationLabel}</div>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function LocationCard({
  scriptId,
  locationId,
  name,
  description,
  manifest,
}: {
  scriptId: string;
  locationId: string;
  name: string;
  description?: string;
  manifest: AssetManifest | undefined;
}) {
  const src = assetSrc(scriptId, manifest, "backgrounds", locationId);
  return (
    <figure
      className="cg-location-card"
      style={{ background: src ? undefined : "var(--cg-surface-alt)" }}
    >
      {src ? <ZoomableImage src={src} alt={manifest?.backgrounds[locationId]?.alt ?? name} /> : null}
      <figcaption>
        <div className="cg-media-caption__title">
          <UiIcon slot="location" scriptId={scriptId} manifest={manifest} className="h-4 w-4" />
          {name}
        </div>
        {description ? (
          <div className="cg-media-caption__description">{description}</div>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function ItemCard({
  scriptId,
  itemId,
  name,
  quantity,
  description,
  manifest,
}: {
  scriptId: string;
  itemId: string;
  name: string;
  quantity: number;
  description?: string;
  manifest: AssetManifest | undefined;
}) {
  const src = assetSrc(scriptId, manifest, "icons", itemId);
  return (
    <div className="cg-item-reveal">
      <div className="cg-item-reveal__main">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="cg-item-reveal__icon" />
        ) : (
          <span className="cg-item-reveal__fallback"
            style={{ background: "var(--cg-primary)", color: "var(--cg-surface)" }}>
            {name.slice(0, 1)}
          </span>
        )}
        <span>{name}</span>
        {quantity > 1 ? (
          <span className="cg-item-reveal__quantity">×{quantity}</span>
        ) : null}
      </div>
      {description ? (
        <span className="cg-item-reveal__description">{description}</span>
      ) : null}
    </div>
  );
}

export function EventCard({ scriptId, eventId, name, manifest }: {
  scriptId: string;
  eventId: string;
  name: string;
  manifest: AssetManifest | undefined;
}) {
  const src = assetSrc(scriptId, manifest, "illustrations", eventId);
  return (
    <figure className="cg-event-card" style={{ background: "var(--cg-surface-alt)" }}>
      {src ? <ZoomableImage src={src} alt={manifest?.illustrations[eventId]?.alt ?? name} /> : null}
      <figcaption className="cg-event-card__caption">
        <UiIcon slot="warning" scriptId={scriptId} manifest={manifest} className="h-4 w-4" />
        {name}
      </figcaption>
    </figure>
  );
}

export function ResolutionChip({
  actionName,
  grade,
  roll,
  dc,
}: {
  actionName: string;
  grade: string;
  roll: number | null;
  dc: number | null;
}) {
  return (
    <span className="cg-resolution-chip">
      {actionName} · {gradeLabel(grade)}
      {roll !== null && dc !== null ? ` (${roll}/${dc})` : ""}
    </span>
  );
}

/** Renders the inline cards for one transcript entry (world entries only). */
export function EntryCards({
  entry,
  scriptId,
  manifest,
  catalog,
  state,
}: {
  entry: TranscriptEntry;
  scriptId: string;
  manifest: AssetManifest | undefined;
  catalog: Catalog | undefined;
  state: WorldState | undefined;
}) {
  const cards: Array<{ key: string; kind: string; payload: Readonly<Record<string, unknown>>; node: React.ReactNode }> = [];
  const eventName = (id: string) => catalog?.events.find((e) => e.id === id)?.name ?? id;
  for (const cue of entry.mediaCues) {
    if (cue.kind === "npc_speech") {
      continue;
    } else if (cue.kind === "location_enter") {
      const loc = catalog?.locations.find((l) => l.id === cue.locationId);
      cards.push({
        key: `loc-${cue.locationId}-${entry.id}`,
        kind: cue.kind,
        payload: { locationId: cue.locationId },
        node: (
          <LocationCard
            scriptId={scriptId}
            locationId={cue.locationId}
            name={loc?.name ?? cue.locationId}
            description={loc?.description}
            manifest={manifest}
          />
        ),
      });
    } else if (cue.kind === "event") {
      cards.push({
        key: `evt-${cue.eventId}-${entry.id}`,
        kind: cue.kind,
        payload: { eventId: cue.eventId },
        node: <EventCard scriptId={scriptId} eventId={cue.eventId} name={eventName(cue.eventId)} manifest={manifest} />,
      });
    } else if (cue.kind === "item_reveal") {
      const item = catalog?.items.find((candidate) => candidate.id === cue.itemId);
      cards.push({
        key: `item-${cue.itemId}-${entry.id}`,
        kind: cue.kind,
        payload: { itemId: cue.itemId, quantity: cue.quantity },
        node: <ItemCard scriptId={scriptId} itemId={cue.itemId} name={item?.name ?? cue.itemId} quantity={cue.quantity} description={item?.description} manifest={manifest} />,
      });
    }
  }
  return cards.length > 0 ? (
    <div className="cg-entry-media">
      {cards.map((card) => state && catalog ? (
        <SlotRenderer
          key={card.key}
          slot={`message-card:${card.kind}`}
          fallback={DefaultMessageCard}
          slotProps={{
            scriptId,
            state,
            catalog,
            assets: manifest ?? emptyAssets,
            entry,
            kind: card.kind,
            payload: card.payload,
            children: card.node,
          }}
        />
      ) : <div key={card.key}>{card.node}</div>)}
    </div>
  ) : null;
}

const emptyAssets: AssetManifest = {
  portraits: {}, backgrounds: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, illustrations: {}, ui: {},
};

function DefaultMessageCard({ children }: MessageCardSlotProps) {
  return <>{children}</>;
}

/** Cue -> human-readable media summary for tests and a11y. */
export function cueSummary(cue: MediaCue, catalog?: Catalog): string {
  switch (cue.kind) {
    case "npc_speech":
      return `npc_speech:${cue.npcId}`;
    case "location_enter":
      return `location_enter:${cue.locationId}`;
    case "event":
      return `event:${cue.eventId}`;
    case "item_reveal":
      return `item_reveal:${cue.itemId}:${cue.quantity}`;
  }
  void catalog;
  return "";
}
