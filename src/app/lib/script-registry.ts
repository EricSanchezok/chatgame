"use client";

import { useSyncExternalStore } from "react";
import type { ScriptUiBundleDescriptor } from "../../shared/client-dto";
import { SCRIPT_UI_API_VERSION } from "../../shared/client-dto";
import type { ScriptUiContext, SlotDef, SlotId } from "../../shared/ui-api";
export type {
  BubbleSlotProps,
  ComposerSlotProps,
  GameShellSlotProps,
  HudSlotProps,
  LauncherSlotProps,
  MessageCardSlotProps,
  ObjectiveTrackerSlotProps,
  PanelSlotProps,
  PauseMenuSlotProps,
  SceneSlotProps,
  ScriptHostModel,
  ScriptUiContext,
  SettingsSlotProps,
  SlotDef,
  SlotId,
  SlotProps,
  ToolbarSlotProps,
} from "../../shared/ui-api";

interface ScriptUiModule {
  apiVersion?: number;
  default?: (context: ScriptUiContext) => void;
}

export interface RegistrySnapshot {
  readonly generation: number;
  readonly scriptId: string | null;
  readonly dependencyHash: string | null;
  readonly status: "idle" | "loading" | "active" | "error";
  readonly slots: ReadonlyMap<SlotId, SlotDef>;
  readonly error: string | null;
}

const EMPTY_SLOTS: ReadonlyMap<SlotId, SlotDef> = new Map();
let generation = 0;
let snapshot: RegistrySnapshot = {
  generation,
  scriptId: null,
  dependencyHash: null,
  status: "idle",
  slots: EMPTY_SLOTS,
  error: null,
};
let retainedActiveSnapshot: RegistrySnapshot | null = null;
const listeners = new Set<() => void>();

function publish(next: RegistrySnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeScriptRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getScriptRegistrySnapshot(): RegistrySnapshot {
  return snapshot;
}

export function useScriptRegistry(): RegistrySnapshot {
  return useSyncExternalStore(
    subscribeScriptRegistry,
    getScriptRegistrySnapshot,
    getScriptRegistrySnapshot,
  );
}

export function getSlot<K extends SlotId>(slot: K): SlotDef<K> | undefined {
  return snapshot.slots.get(slot) as SlotDef<K> | undefined;
}

export function hasSlot(slot: SlotId): boolean {
  return snapshot.slots.has(slot);
}

export function registeredSlots(prefix: `${"panel" | "bubble" | "message-card" | "settings"}:`): SlotId[] {
  return [...snapshot.slots.keys()].filter((slot) => slot.startsWith(prefix));
}

/** Test/host helper: every direct write still publishes an immutable snapshot. */
export function registerSlot<K extends SlotId>(slot: K, def: SlotDef<K>): void {
  validateRegistration(slot, def);
  const slots = new Map(snapshot.slots);
  slots.set(slot, def as SlotDef);
  publish({ ...snapshot, status: "active", slots });
}

export function clearSlots(): void {
  generation += 1;
  retainedActiveSnapshot = null;
  publish({
    generation,
    scriptId: null,
    dependencyHash: null,
    status: "idle",
    slots: EMPTY_SLOTS,
    error: null,
  });
}

function isSlotId(slot: string): slot is SlotId {
  return [
    "launcher",
    "game-shell",
    "scene",
    "hud",
    "objective-tracker",
    "toolbar",
    "composer",
    "pause-menu",
  ].includes(slot) || /^(panel|bubble|message-card|settings):[^:]+$/.test(slot);
}

function validateRegistration(slot: string, def: { component?: unknown }): asserts slot is SlotId {
  if (!isSlotId(slot)) throw new Error(`unknown script UI slot "${slot}"`);
  if (!def || (typeof def.component !== "function" && typeof def.component !== "object")) {
    throw new Error(`slot "${slot}" must register a React component`);
  }
}

export interface LoadScriptUiOptions {
  beforeCommit?: () => void;
  importer?: (url: string) => Promise<ScriptUiModule>;
}

export interface LoadScriptUiResult {
  ok: boolean;
  stale?: boolean;
  error?: string;
  generation: number;
}

/**
 * Builds a temporary registry, validates the complete module, then commits it
 * in one publish. A newer activation makes every older completion a no-op.
 */
export async function loadScriptUi(
  scriptId: string,
  bundle?: ScriptUiBundleDescriptor,
  options: LoadScriptUiOptions = {},
): Promise<LoadScriptUiResult> {
  const previousActive = retainedActiveSnapshot?.scriptId === scriptId
    ? retainedActiveSnapshot
    : null;
  const activation = ++generation;
  publish({ ...snapshot, generation: activation, status: "loading", error: null });

  const commit = (slots: ReadonlyMap<SlotId, SlotDef>, error: string | null) => {
    if (activation !== generation) return false;
    options.beforeCommit?.();
    const next: RegistrySnapshot = {
      generation: activation,
      scriptId,
      dependencyHash: bundle?.dependencyHash ?? null,
      status: error ? "error" : "active",
      slots,
      error,
    };
    if (!error) retainedActiveSnapshot = next;
    publish(next);
    return true;
  };

  if (!bundle) {
    commit(EMPTY_SLOTS, null);
    return { ok: true, generation: activation };
  }

  try {
    if (bundle.apiVersion !== SCRIPT_UI_API_VERSION) {
      throw new Error(`UI API 版本 ${bundle.apiVersion} 不受支持（宿主需要 ${SCRIPT_UI_API_VERSION}）`);
    }
    const importer = options.importer ?? ((url: string) => import(/* webpackIgnore: true */ /* @vite-ignore */ url));
    const uiModule = await importer(bundle.url);
    if (activation !== generation) return { ok: false, stale: true, generation: activation };
    if (uiModule.apiVersion !== SCRIPT_UI_API_VERSION) {
      throw new Error(`剧本 bundle 未声明 UI API v${SCRIPT_UI_API_VERSION}`);
    }
    if (typeof uiModule.default !== "function") throw new Error("剧本 UI bundle 缺少默认注册函数");

    const temporary = new Map<SlotId, SlotDef>();
    const context: ScriptUiContext = {
      apiVersion: SCRIPT_UI_API_VERSION,
      register(slot, def) {
        validateRegistration(slot, def);
        if (temporary.has(slot)) throw new Error(`slot "${slot}" was registered more than once`);
        temporary.set(slot, def as SlotDef);
      },
    };
    uiModule.default(context);
    if (!commit(temporary, null)) return { ok: false, stale: true, generation: activation };
    return { ok: true, generation: activation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (activation !== generation) return { ok: false, stale: true, generation: activation };
    if (previousActive) {
      publish({ ...previousActive, generation: activation, error: message });
    } else if (!commit(EMPTY_SLOTS, message)) {
      return { ok: false, stale: true, generation: activation };
    }
    return { ok: false, error: message, generation: activation };
  }
}
