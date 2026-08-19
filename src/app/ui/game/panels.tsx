"use client";

// Overlay panels: the world data lives behind entry points, not flat on
// screen. A shared centered-modal frame (glass, shadow token, Esc/backdrop
// close) hosts the six panels. Panels are position:fixed overlays — they
// never participate in the shell's flex tracks, so the composer stays put.
// Everything renders from WorldState + static Catalog; unknown ids degrade
// to raw labels instead of crashing.

import { useEffect, useState } from "react";
import type { Catalog, WorldState, AssetManifest } from "../../lib/api";
import { ItemCard } from "./cards";
import { UiIcon } from "./ui-icon";
import type { PanelId } from "./state";

/** Panel-level side effects (advance clock / descriptor edits). */
export interface PanelHandlers {
  onAdvance: (hours: number) => Promise<void>;
  onUpdateDescriptor: (path: string, text: string) => Promise<void>;
}

const PANEL_TITLES: Record<PanelId, string> = {
  inventory: "背包",
  character: "角色",
  relations: "关系",
  tasks: "任务",
  map: "地图",
  log: "日志",
};

/** PanelId -> UiIcon slot (the same set of chrome slots). */
const PANEL_ICON_SLOT: Record<PanelId, "inventory" | "character" | "relations" | "tasks" | "map" | "log"> = {
  inventory: "inventory",
  character: "character",
  relations: "relations",
  tasks: "tasks",
  map: "map",
  log: "log",
};

function fmtClock(state: WorldState): string {
  const c = state.clock;
  return `第 ${c.day} 日 ${c.hour} 时 · ${c.weather} · ${c.season}`;
}

/** Advance control: +1h / +6h / +1d. Time moves forward irrevocably, so
 * every button asks for confirmation once before firing. */
function AdvanceControls({
  onAdvance,
  disabled,
}: {
  onAdvance: (hours: number) => Promise<void>;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const options: Array<{ hours: number; label: string }> = [
    { hours: 1, label: "+1 小时" },
    { hours: 6, label: "+6 小时" },
    { hours: 24, label: "+1 天" },
  ];
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--cg-border)" }}>
      <span className="text-sm" style={{ color: "var(--cg-text-dim)" }}>快进</span>
      {options.map((o) => (
        <button
          key={o.hours}
          type="button"
          disabled={disabled}
          className="cg-chrome rounded-lg border px-2 py-1 text-xs"
          style={{
            borderColor: confirming === o.hours ? "var(--cg-primary)" : "var(--cg-border)",
            color: confirming === o.hours ? "var(--cg-accent)" : "var(--cg-text)",
          }}
          onClick={async () => {
            if (confirming !== o.hours) {
              setConfirming(o.hours);
              return;
            }
            setConfirming(null);
            await onAdvance(o.hours);
          }}
        >
          {confirming === o.hours ? "确认？" : o.label}
        </button>
      ))}
    </div>
  );
}

/** Inline descriptor editor: shows the current description (or a hint),
 * expands into a textarea, and saves through the engine's setDescriptor
 * path — values are never touched (dual-track rule). */
function DescriptorEdit({
  path,
  initial,
  onSave,
}: {
  path: string;
  initial: string;
  onSave: (path: string, text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <div className="mt-1">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={300}
            className="cg-chrome w-full rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", color: "var(--cg-text)" }}
            aria-label="描述编辑"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={saving}
              className="cg-chrome rounded-lg border px-2 py-0.5 text-xs"
              style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(path, text.trim());
                  setEditing(false);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "保存中……" : "保存"}
            </button>
            <button
              type="button"
              className="cg-chrome rounded-lg border px-2 py-0.5 text-xs"
              style={{ borderColor: "var(--cg-border)", color: "var(--cg-text-dim)" }}
              onClick={() => {
                setText(initial);
                setEditing(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>
            {initial || "（暂无描述，点击编辑添加）"}
          </p>
          <button
            type="button"
            className="cg-chrome shrink-0 rounded-lg border px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text-dim)" }}
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
        </div>
      )}
    </div>
  );
}

function PanelFrame({
  panel,
  title,
  scriptId,
  assets,
  onClose,
  children,
}: {
  panel: PanelId;
  title: string;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Lock background scroll while the modal is open; release on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Esc closes from anywhere — the browser focus may stay on the shell
  // behind the overlay, so a document-level listener (registered while the
  // panel is open, cleaned up on unmount) is more reliable than a
  // container onKeyDown. Re-registered when onClose changes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <button
        type="button"
        aria-label="关闭面板"
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in srgb, var(--cg-background) calc(var(--cg-overlay-strength) * 100%), transparent)" }}
        onClick={onClose}
        tabIndex={-1}
      />
      <section
        className="cg-panel cg-glass cg-chrome relative flex max-h-[min(80dvh,100%)] w-full max-w-lg flex-col border p-5 shadow-xl"
        style={{
          borderColor: "var(--cg-border)",
          boxShadow: "var(--cg-shadow-value)",
        }}
      >
        <header className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--cg-border)" }}>
          <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--cg-text)" }}>
            <UiIcon slot={PANEL_ICON_SLOT[panel]} scriptId={scriptId} manifest={assets} className="h-5 w-5" />
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cg-chrome flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
          >
            <UiIcon slot="close" scriptId={scriptId} manifest={assets} className="h-4 w-4" />
            关闭
          </button>
        </header>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}

function InventoryPanel({
  state,
  catalog,
  scriptId,
  assets,
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  panel: PanelId;
}) {
  const stacks = state.player.inventory.stacks;
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.inventory} scriptId={scriptId} assets={assets} onClose={onClose}>
      <p className="mb-3 text-sm" style={{ color: "var(--cg-text-dim)" }}>
        货币：{state.player.inventory.currency} {catalog.currency.symbol}
      </p>
      {stacks.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>背包空空如也。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {stacks.map((s) => {
            const item = catalog.items.find((i) => i.id === s.itemId);
            return (
              <ItemCard
                key={s.itemId}
                scriptId={scriptId}
                itemId={s.itemId}
                name={item?.name ?? s.itemId}
                quantity={s.quantity}
                manifest={assets}
              />
            );
          })}
        </div>
      )}
    </PanelFrame>
  );
}

function CharacterPanel({
  state,
  catalog,
  scriptId,
  assets,
  onClose,
  panel,
  handlers,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  panel: PanelId;
  handlers: PanelHandlers;
}) {
  const hpMax = catalog.stats.find((s) => s.name === catalog.hpStat)?.max ?? 100;
  const hp = state.player.stats[catalog.hpStat] ?? 0;
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.character} scriptId={scriptId} assets={assets} onClose={onClose}>
      <AdvanceControls onAdvance={handlers.onAdvance} disabled={false} />
      <h3 className="font-semibold" style={{ color: "var(--cg-text)" }}>{state.player.name}</h3>
      <p className="mb-3 text-sm" style={{ color: "var(--cg-text-dim)" }}>
        {catalog.origins.find((o) => o.id === state.player.originId)?.name ?? state.player.originId}
      </p>
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-sm">
          <span style={{ color: "var(--cg-text-dim)" }}>生命</span>
          <span style={{ color: "var(--cg-text)" }}>{hp} / {hpMax}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--cg-border)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.max(0, Math.min(100, (hp / hpMax) * 100))}%`,
              background: "var(--cg-primary)",
            }}
          />
        </div>
      </div>
      <dl className="space-y-2 text-sm">
        {catalog.stats.map((s) => (
          <div key={s.name} className="flex justify-between">
            <dt style={{ color: "var(--cg-text-dim)" }}>{s.name}</dt>
            <dd style={{ color: "var(--cg-text)" }}>{state.player.stats[s.name] ?? 0}</dd>
          </div>
        ))}
        {catalog.needs.map((n) => (
          <div key={n.name} className="flex justify-between">
            <dt style={{ color: "var(--cg-text-dim)" }}>{n.name}</dt>
            <dd style={{ color: "var(--cg-text)" }}>{state.player.needs[n.name]?.value ?? 0}</dd>
          </div>
        ))}
      </dl>
      {state.player.statuses.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold" style={{ color: "var(--cg-text)" }}>状态</h4>
          {state.player.statuses.map((st) => (
            <div key={st.statusId} className="text-sm" style={{ color: "var(--cg-text-dim)" }}>
              {catalog.statusEffects.find((s) => s.id === st.statusId)?.name ?? st.statusId}
              {st.stacks > 1 ? ` ×${st.stacks}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </PanelFrame>
  );
}

function RelationsPanel({
  state,
  catalog,
  scriptId,
  assets,
  onClose,
  panel,
  handlers,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  panel: PanelId;
  handlers: PanelHandlers;
}) {
  const rels = state.player.relations;
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.relations} scriptId={scriptId} assets={assets} onClose={onClose}>
      {rels.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>还没有结识任何人。</p>
      ) : (
        <ul className="space-y-3">
          {rels.map((r) => (
            <li key={r.npcId} className="cg-chrome rounded-lg border p-3"
              style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: "var(--cg-text)" }}>
                  {catalog.npcs.find((n) => n.id === r.npcId)?.name ?? r.npcId}
                </span>
                <span className="text-sm" style={{ color: "var(--cg-accent)" }}>
                  {r.descriptor?.label ?? r.stance} {r.value}
                </span>
              </div>
              <DescriptorEdit
                path={`player.relations.${r.npcId}`}
                initial={r.descriptor?.description ?? ""}
                onSave={handlers.onUpdateDescriptor}
              />
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

function TasksPanel({
  state,
  catalog,
  scriptId,
  assets,
  onClose,
  panel,
  handlers,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  panel: PanelId;
  handlers: PanelHandlers;
}) {
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.tasks} scriptId={scriptId} assets={assets} onClose={onClose}>
      <AdvanceControls onAdvance={handlers.onAdvance} disabled={false} />
      {state.tasks.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>暂无任务。</p>
      ) : (
        <ul className="space-y-3">
          {state.tasks.map((t) => {
            const def = catalog.tasks.find((d) => d.id === t.taskId);
            return (
              <li key={t.taskId} className="cg-chrome rounded-lg border p-3"
                style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold" style={{ color: "var(--cg-text)" }}>{def?.name ?? t.taskId}</span>
                  <span className="text-sm" style={{ color: "var(--cg-accent)" }}>
                    {t.status === "active" ? "进行中" : t.status === "complete" ? "已完成" : "已失败"}
                  </span>
                </div>
                {t.status === "active" && "progress" in t ? (
                  <p className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>进度 {t.progress}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </PanelFrame>
  );
}

function MapPanel({
  state,
  catalog,
  scriptId,
  assets,
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  panel: PanelId;
}) {
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.map} scriptId={scriptId} assets={assets} onClose={onClose}>
      <ul className="space-y-2">
        {catalog.locations.map((l) => (
          <li key={l.id} className="cg-chrome rounded-lg border p-3"
            style={{
              borderColor: l.id === state.player.locationId ? "var(--cg-primary)" : "var(--cg-border)",
              background: l.id === state.player.locationId ? "var(--cg-surface-alt)" : undefined,
            }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold" style={{ color: "var(--cg-text)" }}>
                {l.name} {l.id === state.player.locationId ? "· 你在这里" : ""}
              </span>
              <span className="text-xs" style={{ color: "var(--cg-text-dim)" }}>{l.type}</span>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>{l.description}</p>
            {l.connections.length > 0 ? (
              <p className="mt-1 text-xs" style={{ color: "var(--cg-text-dim)" }}>
                通往：{l.connections.map((c) => catalog.locations.find((x) => x.id === c.to)?.name ?? c.to).join("、")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}

function LogPanel({
  state,
  scriptId,
  assets,
  onClose,
  panel,
}: {
  state: WorldState;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  panel: PanelId;
}) {
  const entries = [...state.eventLog].reverse();
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.log} scriptId={scriptId} assets={assets} onClose={onClose}>
      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>还没有记录。</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="text-sm" style={{ color: "var(--cg-text-dim)" }}>
              <span className="mr-2" style={{ color: "var(--cg-accent)" }}>D{e.day} {String(e.hour).padStart(2, "0")}时</span>
              {e.summary}
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

/** The panel switch: renders the active overlay panel (or null). */
export function ActivePanel({
  panel,
  state,
  catalog,
  scriptId,
  assets,
  onClose,
  handlers,
}: {
  panel: PanelId | null;
  state: WorldState;
  catalog: Catalog | undefined;
  scriptId: string;
  assets: AssetManifest | undefined;
  onClose: () => void;
  handlers: PanelHandlers;
}) {
  if (!panel || !catalog) return null;
  switch (panel) {
    case "inventory":
      return (
        <InventoryPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} />
      );
    case "character":
      return <CharacterPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} handlers={handlers} />;
    case "relations":
      return <RelationsPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} handlers={handlers} />;
    case "tasks":
      return <TasksPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} handlers={handlers} />;
    case "map":
      return <MapPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} />;
    case "log":
      return <LogPanel state={state} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} />;
  }
}

export { PANEL_TITLES, fmtClock };
