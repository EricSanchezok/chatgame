"use client";

// World data lives behind deliberate centered dialogs instead of occupying
// permanent layout tracks. Base UI owns dismissal, focus and backdrop behavior.
// Everything renders from WorldState + static Catalog; unknown ids degrade
// to raw labels instead of crashing.

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/shared/ui-runtime";
import type { Catalog, WorldState, AssetManifest } from "../../lib/api";
import type { PanelSlotProps } from "../../lib/script-registry";
import { ItemCard } from "./cards";
import { useGameActions, type PanelId } from "./state";
import { SlotRenderer } from "./slots";
import { Dialog } from "../dialog";
import { useScrollActivity } from "../use-scroll-activity";
import type { PanelSelection } from "./state";

const PANEL_TITLES: Record<PanelId, string> = {
  people: "人物",
  inventory: "背包",
  tasks: "任务",
  map: "地图",
  records: "档案",
};

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

function PanelFrame({
  panel,
  title,
  scriptId,
  onClose,
  children,
}: {
  panel: PanelId;
  title: string;
  scriptId: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const scrollActivity = useScrollActivity();
  return (
    <Dialog
      title={title}
      description="查看当前世界状态与可用资料。"
      onClose={onClose}
      className={panel === "map" ? "cg-game-dialog cg-game-dialog--wide" : "cg-game-dialog"}
    >
      <div {...scrollActivity} data-panel={panel} data-script={scriptId} className="cg-panel-content cg-scroll-surface">{children}</div>
    </Dialog>
  );
}

/**
 * Inline descriptor editor shared by relations / needs / reputation rows:
 * shows the description text with an edit entry that POSTs to the
 * descriptor API (explanation layer only — values are never touched).
 */
function DescriptorEdit({
  path,
  text,
  label,
}: {
  /** Engine DescriptorPath (player.relations.<npc> / .needs.<name> / .reputation.<faction>). */
  path: string;
  text: string;
  /** Human-readable target name for the aria-label. */
  label: string;
}) {
  const { updateDescriptor } = useGameActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  if (editing) {
    return (
      <form
        className="mt-1 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await updateDescriptor(path, draft);
          setEditing(false);
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="cg-chrome min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface)", color: "var(--cg-text)" }}
          aria-label={`编辑${label}的描述`}
        />
        <button type="submit" className="cg-chrome rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--cg-border)", color: "var(--cg-text)" }}>保存</button>
      </form>
    );
  }
  return (
    <>
      {text ? (
        <p className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>{text}</p>
      ) : null}
      <button
        type="button"
        className="mt-1 text-xs underline-offset-2 hover:underline"
        style={{ color: "var(--cg-accent)" }}
        onClick={() => {
          setDraft(text);
          setEditing(true);
        }}
      >
        编辑描述
      </button>
    </>
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
    <PanelFrame panel={panel} title={PANEL_TITLES.inventory} scriptId={scriptId} onClose={onClose}>
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
                description={item?.description}
                manifest={assets}
              />
            );
          })}
        </div>
      )}
    </PanelFrame>
  );
}

function FocusedPersonRow({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    ref.current?.focus({ preventScroll: true });
  }, [focused]);
  return <li ref={ref} tabIndex={-1} data-focused={focused ? "true" : "false"} className="cg-person-row">{children}</li>;
}

function PeoplePanel({
  state,
  catalog,
  scriptId,
  onClose,
  panel,
  focusId,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  onClose: () => void;
  panel: PanelId;
  focusId: string | null;
}) {
  const { advance } = useGameActions();
  const hpMax = catalog.stats.find((s) => s.name === catalog.hpStat)?.max ?? 100;
  const hp = state.player.stats[catalog.hpStat] ?? 0;
  const knownPeople = [...new Set([
    ...state.player.relations.map((relation) => relation.npcId),
    ...(focusId ? [focusId] : []),
  ])];
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.people} scriptId={scriptId} onClose={onClose}>
      <AdvanceControls onAdvance={advance} disabled={false} />
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
      <div className="space-y-2 text-sm">
        {catalog.stats.map((s) => (
          <div key={s.name}>
            <div className="flex justify-between">
              <span style={{ color: "var(--cg-text-dim)" }}>{s.name}</span>
              <span style={{ color: "var(--cg-text)" }}>{state.player.stats[s.name] ?? 0}</span>
            </div>
            {s.description ? (
              <p className="text-xs" style={{ color: "var(--cg-text-dim)" }}>{s.description}</p>
            ) : null}
          </div>
        ))}
        {catalog.skills.map((s) => (
          <div key={s.name}>
            <div className="flex justify-between">
              <span style={{ color: "var(--cg-text-dim)" }}>{s.name}</span>
              <span style={{ color: "var(--cg-text)" }}>{state.player.skills[s.name] ?? 0}</span>
            </div>
            {s.description ? (
              <p className="text-xs" style={{ color: "var(--cg-text-dim)" }}>{s.description}</p>
            ) : null}
          </div>
        ))}
        {catalog.needs.map((n) => {
          const need = state.player.needs[n.name];
          return (
            <div key={n.name}>
              <div className="flex justify-between">
                <span style={{ color: "var(--cg-text-dim)" }}>{n.name}</span>
                <span style={{ color: "var(--cg-text)" }}>
                  {need?.descriptor?.label ? `${need.descriptor.label} · ` : ""}{need?.value ?? 0}
                </span>
              </div>
              <DescriptorEdit
                path={`player.needs.${n.name}`}
                text={need?.descriptor?.description ?? ""}
                label={n.name}
              />
            </div>
          );
        })}
      </div>
      {state.player.reputation.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold" style={{ color: "var(--cg-text)" }}>声望</h4>
          <ul className="space-y-2">
            {state.player.reputation.map((r) => {
              const factionName = catalog.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId;
              return (
                <li key={r.factionId} className="cg-chrome rounded-lg border p-2"
                  style={{ borderColor: "var(--cg-border)", background: "var(--cg-surface-alt)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "var(--cg-text)" }}>{factionName}</span>
                    <span className="text-sm" style={{ color: "var(--cg-accent)" }}>
                      {r.descriptor?.label ? `${r.descriptor.label} · ` : ""}{r.value}
                    </span>
                  </div>
                  <DescriptorEdit
                    path={`player.reputation.${r.factionId}`}
                    text={r.descriptor?.description ?? ""}
                    label={factionName}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {state.player.statuses.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold" style={{ color: "var(--cg-text)" }}>状态</h4>
          {state.player.statuses.map((st) => {
            const statusDef = catalog.statusEffects.find((s) => s.id === st.statusId);
            const desc = st.descriptor?.description ?? statusDef?.description;
            return (
              <div key={st.statusId} className="text-sm" style={{ color: "var(--cg-text-dim)" }}>
                {statusDef?.name ?? st.statusId}
                {st.stacks > 1 ? ` ×${st.stacks}` : ""}
                {desc ? (
                  <span className="ml-1 text-xs" style={{ color: "var(--cg-text-dim)" }}>{desc}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <section className="cg-people-section" aria-labelledby="cg-known-people">
        <h3 id="cg-known-people">认识的人</h3>
      {knownPeople.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>还没有结识任何人。</p>
      ) : (
        <ul className="cg-people-list">
          {knownPeople.map((npcId) => {
            const r = state.player.relations.find((relation) => relation.npcId === npcId);
            const npc = catalog.npcs.find((candidate) => candidate.id === npcId);
            const npcName = npc?.name ?? npcId;
            return (
              <FocusedPersonRow key={npcId} focused={focusId === npcId}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold" style={{ color: "var(--cg-text)" }}>{npcName}</span>
                  <span className="text-sm" style={{ color: "var(--cg-accent)" }}>
                    {r ? `${r.descriptor?.label ?? r.type}${r.value !== 0 ? ` ${r.value}` : ""}` : npc?.occupation ?? "人物"}
                  </span>
                </div>
                {r ? <DescriptorEdit path={`player.relations.${npcId}`} text={r.descriptor?.description || r.description || ""} label={`与${npcName}的关系`} /> : null}
                {npc?.description ? <p className="cg-person-row__description">{npc.description}</p> : null}
              </FocusedPersonRow>
            );
          })}
        </ul>
      )}
      </section>
    </PanelFrame>
  );
}

function TasksPanel({
  state,
  catalog,
  scriptId,
  onClose,
  panel,
  trackedTaskId,
  onTrackTask,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  onClose: () => void;
  panel: PanelId;
  trackedTaskId: string | null;
  onTrackTask: (taskId: string | null) => void;
}) {
  const { advance } = useGameActions();
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.tasks} scriptId={scriptId} onClose={onClose}>
      <AdvanceControls onAdvance={advance} disabled={false} />
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
                  <>
                    <p className="mt-1 text-sm" style={{ color: "var(--cg-text-dim)" }}>{def?.objectiveText ?? "继续推进任务"} · {t.progress}/{def?.quantity ?? 1}</p>
                    <Button type="button" variant="quiet" className="mt-2" aria-pressed={trackedTaskId === t.taskId} onClick={() => onTrackTask(trackedTaskId === t.taskId ? null : t.taskId)}>
                      {trackedTaskId === t.taskId ? "取消追踪" : "追踪任务"}
                    </Button>
                  </>
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
  onClose,
  panel,
}: {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  onClose: () => void;
  panel: PanelId;
}) {
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.map} scriptId={scriptId} onClose={onClose}>
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

function RecordsPanel({
  state,
  scriptId,
  onClose,
  panel,
}: {
  state: WorldState;
  scriptId: string;
  onClose: () => void;
  panel: PanelId;
}) {
  const entries = [...state.eventLog].reverse().slice(0, 50);
  return (
    <PanelFrame panel={panel} title={PANEL_TITLES.records} scriptId={scriptId} onClose={onClose}>
      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--cg-text-dim)" }}>还没有形成档案。</p>
      ) : (
        <ol className="cg-record-list">
          {entries.map((e) => (
            <li key={e.id}>
              <time>第 {e.day} 日 · {String(e.hour).padStart(2, "0")}:00</time>
              <strong>{e.actor}</strong>
              <p>{e.summary}</p>
            </li>
          ))}
        </ol>
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
  trackedTaskId,
  onTrackTask,
}: {
  panel: PanelSelection | null;
  state: WorldState;
  catalog: Catalog | undefined;
  scriptId: string;
  assets: AssetManifest;
  onClose: () => void;
  trackedTaskId: string | null;
  onTrackTask: (taskId: string | null) => void;
}) {
  if (!panel || !catalog) return null;
  const panelId = panel.id;
  const slotProps: PanelSlotProps = {
    panelId,
    focusId: panel.focusId ?? null,
    state,
    catalog,
    scriptId,
    assets,
    trackedTaskId,
    trackTask: onTrackTask,
    close: onClose,
  };
  return (
    <SlotRenderer
      slot={`panel:${panelId}`}
      fallback={DefaultActivePanel}
      slotProps={slotProps}
      scriptWrapper={(node) => (
        <PanelFrame panel={panelId} title={PANEL_TITLES[panelId]} scriptId={scriptId} onClose={onClose}>
          {node}
        </PanelFrame>
      )}
    />
  );
}

function DefaultActivePanel({ panelId: panel, focusId, state, catalog, scriptId, assets, trackedTaskId, trackTask, close: onClose }: PanelSlotProps) {
  switch (panel) {
    case "inventory":
      return (
        <InventoryPanel state={state} catalog={catalog} scriptId={scriptId} assets={assets} onClose={onClose} panel={panel} />
      );
    case "people":
      return <PeoplePanel state={state} catalog={catalog} scriptId={scriptId} onClose={onClose} panel={panel} focusId={focusId} />;
    case "tasks":
      return <TasksPanel state={state} catalog={catalog} scriptId={scriptId} onClose={onClose} panel={panel} trackedTaskId={trackedTaskId} onTrackTask={trackTask} />;
    case "map":
      return <MapPanel state={state} catalog={catalog} scriptId={scriptId} onClose={onClose} panel={panel} />;
    case "records":
      return <RecordsPanel state={state} scriptId={scriptId} onClose={onClose} panel={panel} />;
  }
  return null;
}

export { PANEL_TITLES };
