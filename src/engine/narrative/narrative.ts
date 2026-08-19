// Narrative generation: dual-channel output (I6 — prose NEVER mutates
// state; only mechanics tags validated by the engine do). The LLM narrates
// the engine-resolved outcome; any state claim in the prose is decoration.
import { z } from "zod";
import type { WorldState, ResultGrade, ResolutionLogEntry } from "../types";
import type { WorldDefinition } from "../types";
import type { LLMProvider } from "./provider";
import type { ContextBlocks } from "../context";
import { buildSystemPrompt, buildTurnPrompt } from "./prompt";
import { formatClock } from "../time";

/** Allowed mechanics tag kinds (I3: LLM may only suggest engine-owned effects). */
export const mechanicsTagKindSchema = z.enum([
  "stat",
  "skill",
  "need",
  "item",
  "currency",
  "relation",
  "reputation",
  "flag",
  "teleport",
  "status",
]);

/** Dual-channel narrative output schema. */
export const narrativeOutputSchema = z.object({
  /** Prose narration (decorative — never a state source). */
  narrative: z.string().min(1),
  /** Machine-readable mechanics tags (validated + applied by the engine). */
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

export type NarrativeOutput = z.infer<typeof narrativeOutputSchema>;

export interface NarrativeContext {
  provider: LLMProvider;
  definition: WorldDefinition;
  state: WorldState;
  /** The player's input that triggered this turn. */
  playerInput: string;
  /** Engine resolution result (when an action was resolved). */
  resolution?: ResolutionLogEntry;
  /** NPC speaking (for persona injection). */
  npcId?: string;
  /** Pre-assembled context layers (B/C/D) for hybrid injection. */
  contextBlocks?: ContextBlocks;
}

/**
 * Generates the narrative for a turn. The LLM produces prose + mechanics
 * tags; the engine will validate and apply tags via the PDVA gate
 * (consistency.ts) — the tags here are *suggestions*, never facts.
 */
export async function generateNarrative(
  ctx: NarrativeContext,
): Promise<NarrativeOutput> {
  const system = buildSystemPrompt(ctx.definition);
  const turnPrompt = buildTurnPrompt({
    definition: ctx.definition,
    state: ctx.state,
    playerInput: ctx.playerInput,
    npcId: ctx.npcId,
    actionId: ctx.resolution?.actionId,
    contextBlocks: ctx.contextBlocks,
  });

  const resolutionNote = ctx.resolution
    ? `\n【引擎已结算】动作 ${ctx.resolution.actionId} → ${ctx.resolution.grade}`
    : "";

  // The turn prompt already carries the time in the state snapshot (layer B);
  // only the engine resolution note is appended here.
  const prompt = `${turnPrompt}${resolutionNote}`;

  return ctx.provider.generateObject({
    system,
    prompt,
    schema: narrativeOutputSchema,
  });
}

/**
 * Deterministic fallback narrative (used when the LLM output is rejected
 * or unavailable): narrates the engine resolution without any state claim.
 */
export function fallbackNarrative(
  def: WorldDefinition,
  state: WorldState,
  resolution?: ResolutionLogEntry,
): NarrativeOutput {
  const clockText = formatClock(state.clock);
  const gradeText: Record<ResultGrade, string> = {
    fail: "你没能做到。",
    partial: "你勉强做到了，但付出了代价。",
    success: "你做到了。",
    crit: "你做到了，而且比想象中更好。",
  };
  const text = resolution
    ? `${gradeText[resolution.grade]}（${resolution.actionId}，${clockText}）`
    : `世界安静地继续着。${clockText}`;
  return {
    narrative: text,
    mechanics_tags: [],
  };
}
