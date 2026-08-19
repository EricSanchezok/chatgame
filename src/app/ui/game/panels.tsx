"use client";

// Overlay panels: the world data lives behind entry points, not flat on
// screen. A shared frame (slide-in, glass blur, Esc/backdrop close) hosts
// the six panels. Everything renders from WorldState + static Catalog;
// unknown ids degrade to raw labels instead of crashing.

import type { Catalog, WorldState } from "../../lib/api";
import { ItemCard } from "./cards";
import type { PanelId } from "./state";

const PANEL_TITLES: Record<PanelId, string> = {
  inventory: "背包",
  character: "角色",
  relations: "关系",
  tasks: "任务",
  map: "地图",
  log: "日志",
};

function fmtClock(state: WorldState): string {
  const c = state.clock;
  return `第 ${c.day} 日 ${c.hour} 时 · ${c.weather} · ${c.season}`;
}

function PanelFrame({
  panel,
  title,
  onClose,
  children,
}: {
  panel: PanelId;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        aria-label="关闭面板"
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0,0,0,0.35)" }}
        onClick={onClose}
        tabIndex={-1}
      />
      <section
        className="relative flex h-full w-full max-w-md flex-col border-l p-5 pt-14 shadow-xl"
        style={{
          background: "var(--cg-surface)",
          borderColor: "var(--cg-border)",
          backdropFilter: `blur(${8}px)`,
        }}
      >
        <header className="absolute left-0 right-0 top-0 flex items-center justify-between border-b px-5 py-3"
          style={{ borderColor: "var(--cg-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--cg-text)" }}>
            {title} {panel === "inventory" ? "🎒" : panel === "character" ? "🧑" : panel === "relations" ? "💞" : panel === "tasks" ? "📜" : panel === "map" ? "🗺️" : "📋"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-2.5 py-1 text-sm"
            style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}
          >
            ✕
          </button>
        </header>
        <div className="mt-4 flex-1 overflow-y-auto">{children}</div>
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
  assets: Parameters<typeof ItemCard>[0]["manifest"];
  onClose: () => void;
  panel: PanelId;
}) {
  const stacks = state.player.inventory.stacks;
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.inventory} onClose={onClose}>
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
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  onClose: () => void;
  panel: PanelId;
}) {
  const hpMax = catalog.stats.find((s) => s.name === catalog.hpStat)?.max ?? 100;
  const hp = state.player.stats[catalog.hpStat] ?? 0;
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.character} onClose={onClose}>
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
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  onClose: () => void;
  panel: PanelId;
}) {
  const rels = state.player.relations;
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.relations} onClose={onClose}>
      {rels.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>还没有结识任何人。</p>
      ) : (
        <ul className="space-y-3">
          {rels.map((r) => (
            <li key={r.npcId} className="rounded-lg border p-3"
              style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: "var(--cg-text)" }}>
                  {catalog.npcs.find((n) => n.id === r.npcId)?.name ?? r.npcId}
                </span>
                <span className="text-sm" style={{ color: "var(--cg-accent)" }}>{r.stance} {r.value}</span>
              </div>
              {r.descriptor?.description ? (
                <p className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>{r.descriptor.description}</p>
              ) : null}
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
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  onClose: () => void;
  panel: PanelId;
}) {
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.tasks} onClose={onClose}>
      {state.tasks.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>暂无任务。</p>
      ) : (
        <ul className="space-y-3">
          {state.tasks.map((t) => {
            const def = catalog.tasks.find((d) => d.id === t.taskId);
            return (
              <li key={t.taskId} className="rounded-lg border p-3"
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
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  onClose: () => void;
  panel: PanelId;
}) {
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.map} onClose={onClose}>
      <ul className="space-y-2">
        {catalog.locations.map((l) => (
          <li key={l.id} className="rounded-lg border p-3"
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
  onClose,
  panel,
}: {
  state: WorldState;
  onClose: () => void;
  panel: PanelId;
}) {
  const entries = [...state.eventLog].reverse();
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.log} onClose={onClose}>
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
}: {
  panel: PanelId | null;
  state: WorldState;
  catalog: Catalog | undefined;
  scriptId: string;
  assets: Parameters<typeof ItemCard>[0]["manifest"];
  onClose: () => void;
}) {
  if (!panel || !catalog) return null;
  switch (panel) {
    case "inventory":
      return (
        <InventoryPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} />
      );
    case "character":
      return <CharacterPanel state={state} catalog={catalog} onClose={onClose} panel={panel} />;
    case "relations":
      return <RelationsPanel state={state} catalog={catalog} onClose={onClose} panel={panel} />;
    case "tasks":
      return <TasksPanel state={state} catalog={catalog} onClose={onClose} panel={panel} />;
    case "map":
      return <MapPanel state={state} catalog={catalog} onClose={onClose} panel={panel} />;
    case "log":
      return <LogPanel state={state} onClose={onClose} panel={panel} />;
  }
}

export { PANEL_TITLES, fmtClock };
