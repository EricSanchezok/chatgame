// Client-side script UI registry: slot registration + dynamic bundle loading.
// Pure logic (no React rendering) — slot renderers live in app/ui/game/slots.

export type SlotId =
  | "launcher"
  | "launcher:background"
  | "hud"
  | "toolbar"
  | `panel:${string}`
  | `bubble:${string}`
  | `message-card:${string}`
  | "composer"
  | "pause-menu"
  | `settings:${string}`;

export interface SlotDef {
  component: unknown;
  position?: "top" | "bottom" | "left" | "right";
  order?: number;
}

/** Context handed to a script UI bundle's default export. */
export interface ScriptUiContext {
  register(slot: SlotId, def: SlotDef): void;
}

const slots = new Map<SlotId, SlotDef>();
const loadedModules = new Map<string, unknown>();

export function registerSlot(slot: SlotId, def: SlotDef): void {
  slots.set(slot, def);
}

export function clearSlots(): void {
  slots.clear();
}

export function getSlot(slot: SlotId): SlotDef | undefined {
  return slots.get(slot);
}

export function hasSlot(slot: SlotId): boolean {
  return slots.has(slot);
}

/**
 * Loads a script's compiled UI bundle and runs its default export against the
 * registry context. Always clears slots first so a failed load leaves the UI
 * on framework defaults. Never throws — failures come back as { ok: false }.
 */
export async function loadScriptUi(scriptId: string): Promise<{ ok: boolean; error?: string }> {
  clearSlots();
  try {
    if (!loadedModules.has(scriptId)) {
      loadedModules.set(
        scriptId,
        await import(/* webpackIgnore: true */ `/api/scripts/${scriptId}/ui-bundle`),
      );
    }
    const mod = loadedModules.get(scriptId) as { default?: (ctx: ScriptUiContext) => void };
    const register = mod.default;
    if (typeof register === "function") {
      register({ register: registerSlot });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
