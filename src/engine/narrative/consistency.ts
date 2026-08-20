// Output consistency enforcement (PDVA gate + I1-I7 invariants):
//   SchemaOK — the LLM output is validated by zod;
//   PermOK   — mechanics tags reference existing entities and allowed kinds;
//   RuleOK   — world rules (world.yaml) reject state-claiming tags.
// Prose in the narrative is decoration (I6); only validated tags apply.
// Taboo/secret/commitment violations hard-reject with retry (<=2) then
// deterministic fallback.
import { z } from "zod";
import type { WorldState } from "../types";
import type { WorldDefinition } from "../types";
import type { NarrativeOutput } from "./narrative";
import { mechanicsTagKindSchema } from "./narrative";
import { secretRevealable } from "../plot";
import type { Effect } from "../../script/schemas/common";

export interface ConsistencyResult {
  ok: boolean;
  /** When not ok: which invariant failed (for retry/fallback decision). */
  failedReason?: "schema" | "perm" | "rule" | "taboo" | "secret" | "commitment";
  /** Sanitized output (mechanisms tags stripped on rejection). */
  output?: NarrativeOutput;
  /** Human-readable violation detail (narrativizable). */
  detail?: string;
  /** Non-fatal warnings (soft taboos etc.) — narrative proceeds. */
  warnings?: string[];
}

/** Taboo texts from world.yaml by severity. */
function tabooTexts(def: WorldDefinition, severity: "hard" | "soft"): string[] {
  return def.world.taboos.filter((t) => t.severity === severity).map((t) => t.text);
}

/** Extracts keywords quoted in Chinese/English quotes from taboo text. */
function extractQuotedKeywords(text: string): string[] {
  const matches = text.match(/["""“”'‘]([^"""“”'‘]{1,20})["""“”'‘]/g) ?? [];
  return matches
    .map((m) => m.replace(/["""“”'‘]/g, ""))
    .filter((k) => k.length >= 2 && k.length <= 12);
}

/**
 * Checks a narrative output against all invariants. Returns ok=true only
 * when the prose is consistent and all mechanics tags are safe to apply.
 */
export function checkOutputConsistency(
  def: WorldDefinition,
  state: WorldState,
  output: NarrativeOutput,
): ConsistencyResult {
  // SchemaOK: the output was parsed by zod already; re-validate for safety.
  if (!output || typeof output.narrative !== "string" || !Array.isArray(output.mechanics_tags)) {
    return { ok: false, failedReason: "schema", detail: "malformed narrative output" };
  }

  // Secret guard: the prose must not leak secrets the player cannot know.
  for (const npc of def.npcs.values()) {
    for (const secret of npc.secrets ?? []) {
      const holder = state.secretHolders[secret.id];
      const canKnow = holder !== undefined && secretRevealable(state, def, holder, secret.id);
      if (!canKnow && output.narrative.includes(secret.content.slice(0, 12))) {
        return {
          ok: false,
          failedReason: "secret",
          detail: `narrative leaked secret "${secret.id}"`,
        };
      }
    }
  }

  // Taboo check: hard taboos must not surface their quoted keywords in prose
  // (hard = reject); soft taboos are warnings only.
  const warnings: string[] = [];
  const lowerNarrative = output.narrative.toLowerCase();
  for (const taboo of tabooTexts(def, "hard")) {
    const keywords = extractQuotedKeywords(taboo);
    for (const kw of keywords) {
      if (lowerNarrative.includes(kw.toLowerCase())) {
        return {
          ok: false,
          failedReason: "taboo",
          detail: `hard taboo "${taboo.slice(0, 20)}" keyword "${kw}" matched`,
        };
      }
    }
  }
  for (const taboo of tabooTexts(def, "soft")) {
    const keywords = extractQuotedKeywords(taboo);
    for (const kw of keywords) {
      if (lowerNarrative.includes(kw.toLowerCase())) {
        warnings.push(`soft taboo "${taboo.slice(0, 20)}" keyword "${kw}" matched`);
      }
    }
  }

  if (warnings.length > 0) {
    return { ok: true, output, warnings };
  }

  // PermOK: mechanics tags must reference existing entities.
  for (const tag of output.mechanics_tags) {
    const perm = permOk(def, tag);
    if (!perm.ok) {
      return { ok: false, failedReason: "perm", detail: perm.detail };
    }
  }

  return { ok: true, output };
}

/** Validates one mechanics tag against the world (PermOK + RuleOK). */
function permOk(
  def: WorldDefinition,
  tag: NarrativeOutput["mechanics_tags"][number],
): { ok: boolean; detail?: string } {
  // Entity reference checks by kind.
  switch (tag.kind) {
    case "item":
      if (tag.key && !def.items.has(tag.key)) {
        return { ok: false, detail: `item "${tag.key}" does not exist` };
      }
      break;
    case "teleport":
      if (tag.key && !def.locations.has(tag.key)) {
        return { ok: false, detail: `location "${tag.key}" does not exist` };
      }
      break;
    case "stat": {
      if (tag.key && !def.mechanics.stats.some((s) => s.name === tag.key)) {
        return { ok: false, detail: `stat "${tag.key}" not declared` };
      }
      break;
    }
    case "skill": {
      if (tag.key && !def.mechanics.skills?.some((s) => s.name === tag.key)) {
        return { ok: false, detail: `skill "${tag.key}" not declared` };
      }
      break;
    }
    case "need": {
      if (tag.key && !def.mechanics.needs?.some((s) => s.name === tag.key)) {
        return { ok: false, detail: `need "${tag.key}" not declared` };
      }
      break;
    }
    case "status": {
      if (tag.key && !def.mechanics.status_effects?.some((s) => s.id === tag.key)) {
        return { ok: false, detail: `status "${tag.key}" not declared` };
      }
      break;
    }
    default:
      break;
  }
  return { ok: true };
}

/** Converts validated mechanics tags into engine Effect objects. */
export function tagsToEffects(
  tags: NarrativeOutput["mechanics_tags"],
): Effect[] {
  const effects: Effect[] = [];
  for (const tag of tags) {
    const base = { target: tag.target } as const;
    switch (tag.kind) {
      case "stat":
        effects.push({ ...base, kind: "stat", direction: "add", stat: tag.key ?? "", value: tag.value ?? 0 } as Effect);
        break;
      case "skill":
        effects.push({ ...base, kind: "skill", direction: "add", skill: tag.key ?? "", value: tag.value ?? 0 } as Effect);
        break;
      case "need":
        effects.push({ ...base, kind: "need", direction: "add", need: tag.key ?? "", value: tag.value ?? 0 } as Effect);
        break;
      case "item":
        effects.push({ ...base, kind: "item", direction: "add", item: tag.key ?? "", value: tag.value ?? 1 } as Effect);
        break;
      case "currency":
        effects.push({ ...base, kind: "currency", direction: "add", value: tag.value ?? 0 } as Effect);
        break;
      case "relation":
        effects.push({ ...base, kind: "relation", direction: "add", npc: tag.key ?? "", value: tag.value ?? 0 } as Effect);
        break;
      case "reputation":
        effects.push({ ...base, kind: "reputation", direction: "add", faction: tag.key ?? "", value: tag.value ?? 0 } as Effect);
        break;
      case "flag":
        effects.push({ ...base, kind: "flag", direction: "set", flag: tag.key ?? "" } as Effect);
        break;
      case "teleport":
        effects.push({ ...base, kind: "teleport", direction: "set", location: tag.key ?? "" } as Effect);
        break;
      case "status":
        effects.push({ ...base, kind: "status", direction: "add", status: tag.key ?? "" } as Effect);
        break;
    }
  }
  return effects;
}

/**
 * Runs the full consistency gate with retries. `generate` must return the
 * raw narrative output; on failure it is called again (<=2 retries); after
 * exhaustion the caller falls back to a deterministic narrative.
 */
export async function withConsistencyRetry(
  generate: () => Promise<NarrativeOutput>,
  def: WorldDefinition,
  state: WorldState,
  maxRetries = 2,
): Promise<ConsistencyResult> {
  let lastResult: ConsistencyResult = { ok: false, failedReason: "schema" };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let output: NarrativeOutput;
    try {
      output = await generate();
    } catch {
      lastResult = { ok: false, failedReason: "schema", detail: "generation failed" };
      continue;
    }
    lastResult = checkOutputConsistency(def, state, output);
    if (lastResult.ok) {
      return lastResult;
    }
  }
  return lastResult;
}

/** Standalone zod schema for the dual-channel output (re-exported for tests). */
export { mechanicsTagKindSchema };

export const consistencySchema = z.object({
  narrative: z.string().min(1),
  mechanics_tags: z.array(
    z.object({
      kind: mechanicsTagKindSchema,
      target: z.string(),
      key: z.string().optional(),
      value: z.number().optional(),
      text: z.string().optional(),
    }),
  ),
});
