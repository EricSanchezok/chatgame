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
//
// The generator receives the author's static description/type so the LLM can
// express same-category-but-different-texture nuance ("从小玩到大的朋友" vs
// "酒肉朋友") — the semantic-enum-free design: numbers are the fact source,
// prose carries the meaning.
import type { Descriptor, WorldState, DescriptorUpdate } from "./types";
import type { WorldDefinition } from "./types";
import { relationLabel, reputationLabel } from "./definition";
import { z } from "zod";
import type { LLMProvider } from "./narrative/provider";

/** Max length of a generated description (engineering constraint). */
export const DESCRIPTOR_MAX_CHARS = 300;

/** Stable descriptor paths for UI/save references. */
export type DescriptorPath =
  | `player.relations.${string}`
  | `player.reputation.${string}`
  | `player.needs.${string}`
  | `player.statuses.${string}`
  | `npcs.${string}.relations.${string}`
  | `npcs.${string}.reputation.${string}`
  | `npcs.${string}.needs.${string}`
  | `npcs.${string}.statuses.${string}`;

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
export function fallbackDescription(kind: "relation" | "reputation" | "need" | "status", label: string, value: number): string {
  switch (kind) {
    case "relation":
      return `你们之间的关系是「${label}」（${value}）`;
    case "reputation":
      return `你的名声是「${label}」（${value}）`;
    case "need":
      return `当前状态：${label}（${value}）`;
    case "status":
      return `当前效果：${label}`;
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
   * LLM-backed in real providers. Must anchor on the injected context —
   * including the author's static description/type so the LLM can express
   * the same-category-but-different-texture nuance ("从小玩到大的朋友" vs
   * "酒肉朋友").
   */
  generate(input: {
    kind: "relation" | "reputation" | "need" | "status";
    label: string;
    value: number;
    npcName?: string;
    recentEvents: string[];
    priorDescription?: string;
    /** Author's static description from the script (survives worldgen). */
    authorDescription?: string;
    /** Semantic label (type) from the script ("青梅竹马", "老主顾"). */
    relationType?: string;
  }): Promise<string>;
}

/** Simple deterministic generator used as the default (and fallback). */
export const templateGenerator: DescriptorGenerator = {
  async generate(input) {
    return fallbackDescription(input.kind, input.label, input.value);
  },
};

/** Descriptor output schema (the only LLM-visible description surface). */
export const descriptorOutputSchema = z.object({
  description: z.string().min(1),
});

/**
 * LLM-backed descriptor generator: asks the provider for a <=300 char
 * prose description anchored on the deterministic label/value plus the
 * author's static description/type. Mock returns the deterministic
 * "（模拟描述）" placeholder; real providers return prose. Polarity
 * validation + template fallback stay in refreshDescriptor — a failed or
 * unavailable call never blocks the turn.
 */
export function llmDescriptorGenerator(provider: LLMProvider): DescriptorGenerator {
  return {
    async generate(input) {
      const system =
        "你是游戏状态描述器。根据给定的分类标签与数值，输出一段不超过300字的描述，只解释不评判规则。" +
        "若提供了作者的静态描述，请在其基础上润色与延续，保留其中的细腻语义（如同是朋友，是生死之交还是酒肉朋友）。";
      const prompt = [
        `类型：${input.kind}`,
        `标签：${input.label}`,
        `数值：${input.value}`,
        input.npcName ? `对象：${input.npcName}` : "",
        input.relationType ? `关系类型：${input.relationType}` : "",
        input.authorDescription ? `作者静态描述：${input.authorDescription}` : "",
        input.priorDescription ? `先前的描述：${input.priorDescription}` : "",
        input.recentEvents.length > 0 ? `最近事件：${input.recentEvents.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const out = await provider.generateObject({
        system,
        prompt,
        schema: descriptorOutputSchema,
      });
      return out.description;
    },
  };
}

interface RefreshOptions {
  definition: WorldDefinition;
  generator?: DescriptorGenerator;
  /** Recent event summaries for anchoring (auditable). */
  recentEvents?: string[];
  npcName?: string;
  priorDescription?: string;
  /** Author's static description from the script (survives worldgen). */
  authorDescription?: string;
  /** Semantic label (type) from the script ("青梅竹马", "老主顾"). */
  relationType?: string;
  /** Status-effect display name (for kind === "status"). */
  statusName?: string;
  /** Event-log ids that informed this refresh (audit trail). */
  sourceEventIds?: string[];
}

/**
 * Refreshes a stale descriptor: regenerates prose via the generator,
 * falling back to the deterministic template on any failure. Never touches
 * the numeric value (values are the only fact source).
 */
export async function refreshDescriptor(
  descriptor: Descriptor | undefined,
  kind: "relation" | "reputation" | "need" | "status",
  value: number,
  options: RefreshOptions,
): Promise<Descriptor> {
  const label =
    kind === "need"
      ? "需要关注"
      : kind === "status"
        ? options.statusName ?? "状态"
        : labelForValue(kind, value);
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
      authorDescription: options.authorDescription,
      relationType: options.relationType,
    });
    const clipped =
      text.length > DESCRIPTOR_MAX_CHARS ? text.slice(0, DESCRIPTOR_MAX_CHARS) : text;
    const sourceEventIds = options.sourceEventIds ?? descriptor.sourceEventIds;
    // Rule validation: polarity consistency with the deterministic label.
    // On violation the prose is rejected and the deterministic template is
    // used instead (Blueprint success criterion: 校验失败 -> 确定性模板降级).
    if (!descriptionPolarityOk(label, clipped)) {
      return {
        label,
        description: fallbackDescription(kind, label, value),
        version: descriptor.version + 1,
        stale: false,
        sourceEventIds,
        userEdited: descriptor.userEdited,
      };
    }
    return {
      label,
      description: clipped || fallbackDescription(kind, label, value),
      version: descriptor.version + 1,
      stale: false,
      sourceEventIds,
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
  // Path forms: player.{relations|reputation|needs|statuses}.<target> /
  // npcs.<npc>.{relations|reputation|needs|statuses}.<target>
  const seg = path.split(".");
  if (seg[0] === "player") {
    const target = seg[2];
    if (seg[1] === "relations") {
      return {
        ...state,
        player: {
          ...state.player,
          relations: state.player.relations.map((r) =>
            r.npcId === target ? { ...r, descriptor } : r,
          ),
        },
      };
    }
    if (seg[1] === "reputation") {
      return {
        ...state,
        player: {
          ...state.player,
          reputation: state.player.reputation.map((r) =>
            r.factionId === target ? { ...r, descriptor } : r,
          ),
        },
      };
    }
    if (seg[1] === "needs") {
      return {
        ...state,
        player: {
          ...state.player,
          needs: {
            ...state.player.needs,
            [target]: { value: state.player.needs[target]?.value ?? 0, descriptor },
          },
        },
      };
    }
    if (seg[1] === "statuses") {
      return {
        ...state,
        player: {
          ...state.player,
          statuses: state.player.statuses.map((s) =>
            s.statusId === target ? { ...s, descriptor } : s,
          ),
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
  if (kind === "statuses") {
    return {
      ...state,
      npcs: {
        ...state.npcs,
        [npcId]: {
          ...npc,
          statuses: npc.statuses.map((s) =>
            s.statusId === target ? { ...s, descriptor } : s,
          ),
        },
      },
    };
  }
  return state;
}

/**
 * Collects stale descriptors across the world and returns the updates list
 * (lazy regeneration entry point used by the turn loop). Covers relations
 * (with the author's static description/type as generation context),
 * reputation, needs, and status-effect instances.
 */
export async function refreshAllStale(
  state: WorldState,
  options: Omit<RefreshOptions, "priorDescription"> & { definition: WorldDefinition },
): Promise<{ state: WorldState; updates: DescriptorUpdate[] }> {
  const updates: DescriptorUpdate[] = [];
  const sourceEventIds = state.eventLog.slice(-10).map((e) => e.id);

  // Player relations
  for (const rel of state.player.relations) {
    if (rel.descriptor?.stale || !rel.descriptor) {
      const refreshed = await refreshDescriptor(rel.descriptor, "relation", rel.value, {
        definition: options.definition,
        generator: options.generator,
        recentEvents: options.recentEvents,
        authorDescription: rel.description,
        relationType: rel.type,
        sourceEventIds,
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
        sourceEventIds,
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
        sourceEventIds,
      });
      updates.push({ path: `player.needs.${need}` as DescriptorPath, descriptor: refreshed });
    }
  }
  // Player statuses (wired here: status instances previously had dead
  // descriptor fields — the refresh loop now generates/refreshes them).
  for (const st of state.player.statuses) {
    if (st.descriptor?.stale || !st.descriptor) {
      const statusDef = options.definition.mechanics.status_effects?.find((s) => s.id === st.statusId);
      const refreshed = await refreshDescriptor(st.descriptor, "status", st.stacks, {
        definition: options.definition,
        generator: options.generator,
        recentEvents: options.recentEvents,
        statusName: statusDef?.name,
        authorDescription: statusDef?.description,
        sourceEventIds,
      });
      updates.push({ path: `player.statuses.${st.statusId}` as DescriptorPath, descriptor: refreshed });
    }
  }

  // NPC relations / reputation / needs / statuses
  for (const [npcId, npc] of Object.entries(state.npcs)) {
    const npcName = options.definition.npcs.get(npcId)?.name;
    for (const rel of npc.relations) {
      if (rel.descriptor?.stale || !rel.descriptor) {
        const refreshed = await refreshDescriptor(rel.descriptor, "relation", rel.value, {
          definition: options.definition,
          generator: options.generator,
          recentEvents: options.recentEvents,
          npcName,
          authorDescription: rel.description,
          relationType: rel.type,
          sourceEventIds,
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
          sourceEventIds,
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
          sourceEventIds,
        });
        updates.push({ path: `npcs.${npcId}.needs.${need}` as DescriptorPath, descriptor: refreshed });
      }
    }
    for (const st of npc.statuses) {
      if (st.descriptor?.stale || !st.descriptor) {
        const statusDef = options.definition.mechanics.status_effects?.find((s) => s.id === st.statusId);
        const refreshed = await refreshDescriptor(st.descriptor, "status", st.stacks, {
          definition: options.definition,
          generator: options.generator,
          recentEvents: options.recentEvents,
          npcName,
          statusName: statusDef?.name,
          authorDescription: statusDef?.description,
          sourceEventIds,
        });
        updates.push({ path: `npcs.${npcId}.statuses.${st.statusId}` as DescriptorPath, descriptor: refreshed });
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
    if (seg[1] === "statuses") return state.player.statuses.find((s) => s.statusId === seg[2])?.descriptor;
    return undefined;
  }
  const npc = state.npcs[seg[1]];
  if (!npc) return undefined;
  if (seg[2] === "relations") return npc.relations.find((r) => r.npcId === seg[3])?.descriptor;
  if (seg[2] === "reputation") return npc.reputation.find((r) => r.factionId === seg[3])?.descriptor;
  if (seg[2] === "needs") return npc.needs[seg[3]]?.descriptor;
  if (seg[2] === "statuses") return npc.statuses.find((s) => s.statusId === seg[3])?.descriptor;
  return undefined;
}
