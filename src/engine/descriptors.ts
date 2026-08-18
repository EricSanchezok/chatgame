// Dual-track state descriptor layer (双轨状态描述层).
//
// Three-layer separation (30-year industry pattern, validated by research):
//   - computation layer: numeric values (engine-owned, only fact source,
//     participates in resolution)
//   - classification layer: deterministic labels (value -> stance/type)
//   - explanation layer: LLM prose descriptions (<=300 chars) that explain
//     quality — "relation 100 but friend vs lover" — and NEVER participate
//     in resolution (RimWorld thoughts / CK3 modifiers precedent).
//
// Descriptors are lazily regenerated when stale (event or threshold
// triggered), fall back to deterministic templates when generation fails,
// and are user-editable without touching values.
import type { Descriptor, WorldState, DescriptorUpdate } from "./types";
import type { WorldDefinition } from "./types";
import { relationLabel, reputationLabel } from "./definition";

/** Max length of a generated description (engineering constraint). */
export const DESCRIPTOR_MAX_CHARS = 300;

/** Stable descriptor paths for UI/save references. */
export type DescriptorPath =
  | `player.relations.${string}`
  | `player.reputation.${string}`
  | `player.needs.${string}`
  | `npcs.${string}.relations.${string}`
  | `npcs.${string}.reputation.${string}`
  | `npcs.${string}.needs.${string}`;

/** Creates a fresh stale descriptor with the deterministic label. */
export function createDescriptor(label: string, description = ""): Descriptor {
  return {
    label,
    description,
    version: 0,
    stale: true,
    sourceEventIds: [],
    userEdited: false,
  };
}

/** Deterministic fallback template (used when LLM generation fails/absent). */
export function fallbackDescription(kind: "relation" | "reputation" | "need", label: string, value: number): string {
  switch (kind) {
    case "relation":
      return `你们之间的关系是「${label}」（${value}）`;
    case "reputation":
      return `你的名声是「${label}」（${value}）`;
    case "need":
      return `当前状态：${label}（${value}）`;
  }
}

/**
 * Polarity consistency check (minimal rule validator, Blueprint success
 * criterion): a description must not contradict its deterministic label.
 * Negative labels (死敌/仇视/冷淡/恶名昭著/声名狼藉) must not contain
 * positive-polarity keywords (信任/亲近/友善/挚友/德高望重/喜欢); positive
 * labels (友善/亲近/挚友/小有名望/德高望重) must not contain negative
 * keywords (仇恨/厌恶/敌视/背叛). Returns true when the text is consistent.
 */
const POSITIVE_KEYWORDS = ["信任", "亲近", "友善", "挚友", "喜欢", "德高望重", "小有名望", "欣赏"];
const NEGATIVE_KEYWORDS = ["仇恨", "厌恶", "敌视", "背叛", "死敌", "仇视", "冷淡", "恶名昭著", "声名狼藉", "憎恨"];
const POSITIVE_LABELS = ["友善", "亲近", "挚友", "小有名望", "德高望重"];
const NEGATIVE_LABELS = ["死敌", "仇视", "冷淡", "恶名昭著", "声名狼藉"];

/**
 * Whether `text` contains `keyword` NOT preceded by a negation (不/无/没/未).
 * "从不信任" must not count as a positive mention of 信任.
 */
function containsAffirmedKeyword(text: string, keyword: string): boolean {
  let idx = text.indexOf(keyword);
  while (idx >= 0) {
    const prev = idx > 0 ? text[idx - 1] : "";
    if (!["不", "无", "没", "未", "非"].includes(prev)) return true;
    idx = text.indexOf(keyword, idx + keyword.length);
  }
  return false;
}

export function descriptionPolarityOk(label: string, description: string): boolean {
  const isPositiveLabel = POSITIVE_LABELS.some((l) => label.includes(l));
  const isNegativeLabel = NEGATIVE_LABELS.some((l) => label.includes(l));
  if (isPositiveLabel) {
    return !NEGATIVE_KEYWORDS.some((k) => containsAffirmedKeyword(description, k));
  }
  if (isNegativeLabel) {
    return !POSITIVE_KEYWORDS.some((k) => containsAffirmedKeyword(description, k));
  }
  return true; // neutral/unknown labels have no polarity contract
}

/** Returns the deterministic label for a value of a given kind. */
export function labelForValue(kind: "relation" | "reputation", value: number): string {
  return kind === "relation" ? relationLabel(value) : reputationLabel(value);
}

/** Whether a value change crossed a classification band boundary. */
export function crossedBand(
  kind: "relation" | "reputation",
  before: number,
  after: number,
): boolean {
  return labelForValue(kind, before) !== labelForValue(kind, after);
}

export interface DescriptorGenerator {
  /**
   * Generates a prose description (<=300 chars). Deterministic in Mock;
   * LLM-backed in real providers. Must anchor on the injected context.
   */
  generate(input: {
    kind: "relation" | "reputation" | "need";
    label: string;
    value: number;
    npcName?: string;
    recentEvents: string[];
    priorDescription?: string;
  }): Promise<string>;
}

/** Simple deterministic generator used as the default (and fallback). */
export const templateGenerator: DescriptorGenerator = {
  async generate(input) {
    return fallbackDescription(input.kind, input.label, input.value);
  },
};

interface RefreshOptions {
  definition: WorldDefinition;
  generator?: DescriptorGenerator;
  /** Recent event summaries for anchoring (auditable). */
  recentEvents?: string[];
  npcName?: string;
  priorDescription?: string;
}

/**
 * Refreshes a stale descriptor: regenerates prose via the generator,
 * falling back to the deterministic template on any failure. Never touches
 * the numeric value (values are the only fact source).
 */
export async function refreshDescriptor(
  descriptor: Descriptor | undefined,
  kind: "relation" | "reputation" | "need",
  value: number,
  options: RefreshOptions,
): Promise<Descriptor> {
  const label = kind === "need" ? "需要关注" : labelForValue(kind, value);
  if (!descriptor) {
    return createDescriptor(label);
  }
  if (descriptor.userEdited && !descriptor.stale) {
    return descriptor; // user override is authoritative until value changes
  }
  if (!descriptor.stale) {
    return descriptor; // fresh — no regeneration
  }
  const gen = options.generator ?? templateGenerator;
  try {
    const text = await gen.generate({
      kind,
      label,
      value,
      npcName: options.npcName,
      recentEvents: options.recentEvents ?? [],
      priorDescription: options.priorDescription,
    });
    const clipped =
      text.length > DESCRIPTOR_MAX_CHARS ? text.slice(0, DESCRIPTOR_MAX_CHARS) : text;
    // Rule validation: polarity consistency with the deterministic label.
    // On violation the prose is rejected and the deterministic template is
    // used instead (Blueprint success criterion: 校验失败 -> 确定性模板降级).
    if (!descriptionPolarityOk(label, clipped)) {
      return {
        label,
        description: fallbackDescription(kind, label, value),
        version: descriptor.version + 1,
        stale: false,
        sourceEventIds: descriptor.sourceEventIds,
        userEdited: descriptor.userEdited,
      };
    }
    return {
      label,
      description: clipped || fallbackDescription(kind, label, value),
      version: descriptor.version + 1,
      stale: false,
      sourceEventIds: descriptor.sourceEventIds,
      userEdited: descriptor.userEdited,
    };
  } catch {
    return {
      label,
      description: fallbackDescription(kind, label, value),
      version: descriptor.version + 1,
      stale: false,
      sourceEventIds: descriptor.sourceEventIds,
      userEdited: descriptor.userEdited,
    };
  }
}

/** Marks a descriptor stale (called by the engine event bus on relevant changes). */
export function markStale(descriptor: Descriptor | undefined): Descriptor | undefined {
  if (!descriptor) return descriptor;
  return descriptor.stale ? descriptor : { ...descriptor, stale: true };
}

/**
 * User/author edit: sets the description, keeps the value untouched, and
 * marks userEdited so the engine stops regenerating until value changes.
 */
export function editDescriptor(
  descriptor: Descriptor,
  text: string,
): Descriptor {
  return {
    ...descriptor,
    description: text.slice(0, DESCRIPTOR_MAX_CHARS),
    stale: false,
    userEdited: true,
  };
}

/** Applies a descriptor update to the world state (immutable). */
export function applyDescriptorUpdate(
  state: WorldState,
  path: DescriptorPath,
  descriptor: Descriptor,
): WorldState {
  // Path forms: player.relations.<npc> / player.reputation.<faction> /
  // player.needs.<need> / npcs.<npc>.relations.<target> / npcs.<npc>.reputation.<faction> / npcs.<npc>.needs.<need>
  const seg = path.split(".");
  if (seg[0] === "player") {
    if (seg[1] === "relations") {
      const npcId = seg[2];
      return {
        ...state,
        player: {
          ...state.player,
          relations: state.player.relations.map((r) =>
            r.npcId === npcId ? { ...r, descriptor } : r,
          ),
        },
      };
    }
    if (seg[1] === "reputation") {
      const factionId = seg[2];
      return {
        ...state,
        player: {
          ...state.player,
          reputation: state.player.reputation.map((r) =>
            r.factionId === factionId ? { ...r, descriptor } : r,
          ),
        },
      };
    }
    if (seg[1] === "needs") {
      const need = seg[2];
      return {
        ...state,
        player: {
          ...state.player,
          needs: {
            ...state.player.needs,
            [need]: { value: state.player.needs[need]?.value ?? 0, descriptor },
          },
        },
      };
    }
    return state;
  }
  // npcs.<npc>.<kind>.<target>
  const npcId = seg[1];
  const kind = seg[2];
  const target = seg[3];
  const npc = state.npcs[npcId];
  if (!npc) return state;
  if (kind === "relations") {
    return {
      ...state,
      npcs: {
        ...state.npcs,
        [npcId]: {
          ...npc,
          relations: npc.relations.map((r) =>
            r.npcId === target ? { ...r, descriptor } : r,
          ),
        },
      },
    };
  }
  if (kind === "reputation") {
    return {
      ...state,
      npcs: {
        ...state.npcs,
        [npcId]: {
          ...npc,
          reputation: npc.reputation.map((r) =>
            r.factionId === target ? { ...r, descriptor } : r,
          ),
        },
      },
    };
  }
  if (kind === "needs") {
    return {
      ...state,
      npcs: {
        ...state.npcs,
        [npcId]: {
          ...npc,
          needs: {
            ...npc.needs,
            [target]: { value: npc.needs[target]?.value ?? 0, descriptor },
          },
        },
      },
    };
  }
  return state;
}

/**
 * Collects stale descriptors across the world and returns the updates list
 * (lazy regeneration entry point used by the turn loop).
 */
export async function refreshAllStale(
  state: WorldState,
  options: Omit<RefreshOptions, "priorDescription"> & { definition: WorldDefinition },
): Promise<{ state: WorldState; updates: DescriptorUpdate[] }> {
  const updates: DescriptorUpdate[] = [];

  // Player relations
  for (const rel of state.player.relations) {
    if (rel.descriptor?.stale || !rel.descriptor) {
      const refreshed = await refreshDescriptor(rel.descriptor, "relation", rel.value, {
        definition: options.definition,
        generator: options.generator,
        recentEvents: options.recentEvents,
      });
      updates.push({ path: `player.relations.${rel.npcId}` as DescriptorPath, descriptor: refreshed });
    }
  }
  // Player reputation
  for (const rep of state.player.reputation) {
    if (rep.descriptor?.stale || !rep.descriptor) {
      const refreshed = await refreshDescriptor(rep.descriptor, "reputation", rep.value, {
        definition: options.definition,
        generator: options.generator,
        recentEvents: options.recentEvents,
      });
      updates.push({ path: `player.reputation.${rep.factionId}` as DescriptorPath, descriptor: refreshed });
    }
  }
  // Player needs
  for (const [need, ns] of Object.entries(state.player.needs)) {
    if (ns.descriptor?.stale || !ns.descriptor) {
      const refreshed = await refreshDescriptor(ns.descriptor, "need", ns.value, {
        definition: options.definition,
        generator: options.generator,
        recentEvents: options.recentEvents,
      });
      updates.push({ path: `player.needs.${need}` as DescriptorPath, descriptor: refreshed });
    }
  }

  // NPC relations / reputation / needs
  for (const [npcId, npc] of Object.entries(state.npcs)) {
    const npcName = options.definition.npcs.get(npcId)?.name;
    for (const rel of npc.relations) {
      if (rel.descriptor?.stale || !rel.descriptor) {
        const refreshed = await refreshDescriptor(rel.descriptor, "relation", rel.value, {
          definition: options.definition,
          generator: options.generator,
          recentEvents: options.recentEvents,
          npcName,
        });
        updates.push({ path: `npcs.${npcId}.relations.${rel.npcId}` as DescriptorPath, descriptor: refreshed });
      }
    }
    for (const rep of npc.reputation) {
      if (rep.descriptor?.stale || !rep.descriptor) {
        const refreshed = await refreshDescriptor(rep.descriptor, "reputation", rep.value, {
          definition: options.definition,
          generator: options.generator,
          recentEvents: options.recentEvents,
          npcName,
        });
        updates.push({ path: `npcs.${npcId}.reputation.${rep.factionId}` as DescriptorPath, descriptor: refreshed });
      }
    }
    for (const [need, ns] of Object.entries(npc.needs)) {
      if (ns.descriptor?.stale || !ns.descriptor) {
        const refreshed = await refreshDescriptor(ns.descriptor, "need", ns.value, {
          definition: options.definition,
          generator: options.generator,
          recentEvents: options.recentEvents,
          npcName,
        });
        updates.push({ path: `npcs.${npcId}.needs.${need}` as DescriptorPath, descriptor: refreshed });
      }
    }
  }

  let next = state;
  for (const u of updates) {
    next = applyDescriptorUpdate(next, u.path as DescriptorPath, u.descriptor);
  }
  return { state: next, updates };
}

/**
 * The engine exposes setDescriptor() for user edits; this helper applies
 * the edit and returns the new state + the update record.
 */
export function setUserDescriptor(
  state: WorldState,
  path: DescriptorPath,
  text: string,
): { state: WorldState; update: DescriptorUpdate } {
  const existing = resolveDescriptor(state, path);
  // When no descriptor exists yet, create one (still user-edited).
  const edited = editDescriptor(
    existing ?? createDescriptor("", ""),
    text,
  );
  return { state: applyDescriptorUpdate(state, path, edited), update: { path, descriptor: edited } };
}

/** Resolves the descriptor at a stable path (for edits/reads). */
function resolveDescriptor(state: WorldState, path: DescriptorPath): Descriptor | undefined {
  const seg = path.split(".");
  if (seg[0] === "player") {
    if (seg[1] === "relations") return state.player.relations.find((r) => r.npcId === seg[2])?.descriptor;
    if (seg[1] === "reputation") return state.player.reputation.find((r) => r.factionId === seg[2])?.descriptor;
    if (seg[1] === "needs") return state.player.needs[seg[2]]?.descriptor;
    return undefined;
  }
  const npc = state.npcs[seg[1]];
  if (!npc) return undefined;
  if (seg[2] === "relations") return npc.relations.find((r) => r.npcId === seg[3])?.descriptor;
  if (seg[2] === "reputation") return npc.reputation.find((r) => r.factionId === seg[3])?.descriptor;
  if (seg[2] === "needs") return npc.needs[seg[3]]?.descriptor;
  return undefined;
}
