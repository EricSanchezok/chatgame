// Intent parsing: maps player free text to a structured action via the
// LLM (Mock in tests/demo), with deterministic fallback tiers (I7:
// rejections are narrativized; ambiguity degrades to talk — Bartle's
// tolerance principle). The engine ALWAYS validates the parsed intent
// (I2/I4: rules are engine-side).
import { z } from "zod";
import type { WorldState } from "../types";
import type { WorldDefinition } from "../types";
import type { LLMProvider } from "./provider";
import { buildIntentPrompt } from "./prompt";
import { isKnownAction } from "../rules";

/** Structured intent produced by the LLM (or the deterministic fallback). */
export const intentSchema = z.object({
  actionId: z.string(),
  target: z.string().optional(),
  /** True when the input was judged impossible/overpowered (reject, don't degrade). */
  reject: z.boolean().optional(),
  /** Free-form clarification question when the intent is ambiguous. */
  clarification: z.string().optional(),
});

export type ParsedIntent = z.infer<typeof intentSchema>;

export type IntentTier =
  | { tier: "direct"; intent: ParsedIntent }
  | { tier: "clarify"; question: string }
  | { tier: "fallback_talk"; intent: ParsedIntent }
  | { tier: "reject"; reason: string };

/** Deterministic vocabulary-only fallback: returns ALL candidate actions. */
function vocabularyCandidates(
  def: WorldDefinition,
  input: string,
): ParsedIntent[] {
  const lower = input.toLowerCase();
  const candidates: ParsedIntent[] = [];
  for (const action of def.actions.actions) {
    if (!action.enabled) continue;
    // Match the action id or its display name as a substring.
    if (lower.includes(action.id) || (action.display_name && input.includes(action.display_name))) {
      candidates.push({ actionId: action.id, target: extractTarget(def, input) });
    }
  }
  return candidates;
}

/** Best-effort target extraction: find a known npc/item/location name in the text. */
function extractTarget(def: WorldDefinition, input: string): string | undefined {
  for (const npc of def.npcs.values()) {
    if (input.includes(npc.name) || input.includes(npc.id)) return npc.id;
  }
  for (const loc of def.locations.values()) {
    if (input.includes(loc.name) || input.includes(loc.id)) return loc.id;
  }
  for (const item of def.items.values()) {
    if (input.includes(item.name) || input.includes(item.id)) return item.id;
  }
  return undefined;
}

/** Detects obvious overpowered requests (deterministic gate before LLM). */
function detectObviousCheat(input: string): string | undefined {
  const lower = input.toLowerCase();
  const cheatPatterns: Array<[RegExp, string]> = [
    [/瞬移|传送到|teleport|appear at/, "teleport"],
    [/开挂|作弊|god mode|cheat|give me 1000/, "cheat"],
    [/凭空|变出|materialize|create out of thin/, "matter_creation"],
    [/无敌|immortal|invincible/, "invincibility"],
  ];
  for (const [re, reason] of cheatPatterns) {
    if (re.test(lower)) return reason;
  }
  return undefined;
}

/**
 * Parses the player's free text into a structured intent. Tiers:
 *   1. obvious cheat gate (deterministic) -> reject
 *   2. LLM structured parse -> direct / clarify / reject
 *   3. vocabulary fallback -> direct / fallback_talk
 */
export async function parseIntent(
  provider: LLMProvider,
  def: WorldDefinition,
  state: WorldState,
  input: string,
): Promise<IntentTier> {
  // Tier 1: deterministic cheat gate (never trusts the LLM with rules).
  const cheat = detectObviousCheat(input);
  if (cheat) {
    return { tier: "reject", reason: cheat };
  }

  // Tier 2: LLM structured parse.
  try {
    const { system, prompt } = buildIntentPrompt(def, state, input);
    const intent = await provider.generateObject({
      system,
      prompt,
      schema: intentSchema,
    });
    if (intent.reject) {
      return { tier: "reject", reason: "llm_reject" };
    }
    if (intent.clarification) {
      return { tier: "clarify", question: intent.clarification };
    }
    if (isKnownAction(def, intent.actionId)) {
      return { tier: "direct", intent };
    }
    // Unknown action from LLM -> fall through to vocabulary fallback.
  } catch {
    // LLM unavailable -> fall through to deterministic fallback.
  }

  // Tier 3: deterministic vocabulary fallback with ambiguity tiers.
  const candidates = vocabularyCandidates(def, input);
  if (candidates.length === 0) {
    return { tier: "fallback_talk", intent: { actionId: "talk" } };
  }
  if (candidates.length === 1) {
    return { tier: "direct", intent: candidates[0] };
  }
  // Multiple candidate actions -> ask for clarification (Bartle tolerance:
  // ambiguity degrades to a question, not a random guess).
  return {
    tier: "clarify",
    question: `你指的是哪个行动？${candidates.map((c) => c.actionId).join("、")}`,
  };
}
