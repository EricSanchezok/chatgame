"use client";

// Inline message cards: rendered inside the chat stream, driven by
// resolution + mediaCues. Every card degrades gracefully — no portrait
// -> initial-letter avatar, no background -> solid color card.

import type { AssetManifest, Catalog, MediaCue, TranscriptEntry, WorldState } from "../../lib/api";
import { httpGamePort } from "../../lib/api";
import { UiIcon } from "./ui-icon";
import { SlotRenderer } from "./slots";
import type { MessageCardSlotProps } from "../../lib/script-registry";

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
    <figure className="my-2 flex items-center gap-3 rounded-xl border p-3"
      style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={npcName}
          className="h-14 w-14 shrink-0 rounded-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
            (e.currentTarget.nextElementSibling as HTMLElement | null)?.classList.remove("hidden");
          }}
        />
      ) : null}
      <AvatarFallback name={npcName} />
      <figcaption className="min-w-0">
        <div className="font-semibold" style={{ color: "var(--cg-text)" }}>{npcName}</div>
        {relationLabel ? (
          <div className="text-sm" style={{ color: "var(--cg-text-dim)" }}>{relationLabel}</div>
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
      className="my-2 overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--cg-border)", background: src ? undefined : "var(--cg-surface-alt)" }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-32 w-full object-cover" />
      ) : null}
      <figcaption className="p-3">
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--cg-text)" }}>
          <UiIcon slot="location" scriptId={scriptId} manifest={manifest} className="h-4 w-4" />
          {name}
        </div>
        {description ? (
          <div className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>{description}</div>
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
    <div className="my-1 inline-flex flex-col gap-0.5 rounded-lg border px-3 py-1.5"
      style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
      <div className="flex items-center gap-2">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="h-6 w-6 object-contain" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded text-xs"
            style={{ background: "var(--cg-primary)", color: "var(--cg-surface)" }}>
            {name.slice(0, 1)}
          </span>
        )}
        <span style={{ color: "var(--cg-text)" }}>{name}</span>
        {quantity > 1 ? (
          <span className="text-sm" style={{ color: "var(--cg-text-dim)" }}>×{quantity}</span>
        ) : null}
      </div>
      {description ? (
        <span className="text-xs" style={{ color: "var(--cg-text-dim)" }}>{description}</span>
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
  const src = assetSrc(scriptId, manifest, "effects", eventId);
  void src; // effect audio plays via cuesToAudio; the card is text-only.
  return (
    <div className="my-1 rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
      <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--cg-accent)" }}>
        <UiIcon slot="warning" scriptId={scriptId} manifest={manifest} className="h-4 w-4" />
        {name}
      </span>
    </div>
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
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
      style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)", color: "var(--cg-text)" }}>
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
  const npcName = (id: string) => catalog?.npcs.find((n) => n.id === id)?.name ?? id;
  const eventName = (id: string) => catalog?.events.find((e) => e.id === id)?.name ?? id;
  for (const cue of entry.mediaCues) {
    if (cue.kind === "npc_speech") {
      const rel = state?.player.relations.find((r) => r.npcId === cue.npcId);
      cards.push({
        key: `npc-${cue.npcId}-${entry.id}`,
        kind: cue.kind,
        payload: { npcId: cue.npcId },
        node: (
          <NpcCard
            scriptId={scriptId}
            npcId={cue.npcId}
            npcName={npcName(cue.npcId)}
            relationLabel={rel ? `${rel.stance} ${rel.value}` : undefined}
            manifest={manifest}
          />
        ),
      });
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
    }
  }
  return cards.length > 0 ? (
    <div className="mt-2 flex flex-col">
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
  portraits: {}, backgrounds: {}, icons: {}, sprites: {}, voices: {}, ambient: {}, effects: {}, ui: {},
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
  }
  void catalog;
  return "";
}
