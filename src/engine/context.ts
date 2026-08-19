// LLM context management: three-layer hybrid injection (recent N turns
// verbatim + rolling summary + structured state snapshot) and the rolling
// context summary (context compaction). Consumes run.yaml context_compaction
// and is the first caller of LLMProvider.generateText.
//
// Layer ownership:
//   - short-term: transcript verbatim (recent window)
//   - mid-term: rolling summary (engine-held, persisted, generated via
//     generateText with a template that keeps facts and drops atmosphere)
//   - long-term: engine memory (unchanged — engine writes, LLM never writes)
//   - facts: numeric engine state (values are the only fact source;
//     descriptions are injected by prompt.ts via the 关系与状态摘要 block)
import type { WorldState, WorldDefinition, TranscriptEntry } from "./types";
import { z } from "zod";
import { formatClock } from "./time";
import type { LLMProvider } from "./narrative/provider";

// ---------------------------------------------------------------------------
// Tunables (defaults; overridable per-script via run.ext.llm_context)
// ---------------------------------------------------------------------------

/** Default recent-turn verbatim window (industry consensus ~5-8 turns). */
export const CONTEXT_WINDOW_TURNS = 6;
/** Turn-count fallback: summarize at least every N turns. */
export const SUMMARY_EVERY_TURNS = 8;
/** Trigger ratio: summarize when transcript+summary chars exceed budget*ratio. */
export const SUMMARY_TRIGGER_RATIO = 0.65;
/** Conservative char budget for injected context (1 CJK char ~ 1-3 tokens). */
export const CONTEXT_TOKEN_BUDGET = 24000;
/** Max chars for a generated summary (conservative token ceiling). */
export const SUMMARY_MAX_CHARS = 6000;

// ---------------------------------------------------------------------------
// Run-level overrides (run.ext.llm_context) — optional, defaults locked
// ---------------------------------------------------------------------------

export interface ContextConfig {
  windowTurns: number;
  summaryEveryTurns: number;
  triggerRatio: number;
  budget: number;
  summaryMaxChars: number;
}

export function contextConfig(definition: WorldDefinition): ContextConfig {
  const ext = definition.run.ext?.llm_context as
    | {
        window_turns?: number;
        summary_every_turns?: number;
        trigger_ratio?: number;
        budget?: number;
        summary_max_chars?: number;
      }
    | undefined;
  return {
    windowTurns: ext?.window_turns ?? CONTEXT_WINDOW_TURNS,
    summaryEveryTurns: ext?.summary_every_turns ?? SUMMARY_EVERY_TURNS,
    triggerRatio: ext?.trigger_ratio ?? SUMMARY_TRIGGER_RATIO,
    budget: ext?.budget ?? CONTEXT_TOKEN_BUDGET,
    summaryMaxChars: ext?.summary_max_chars ?? SUMMARY_MAX_CHARS,
  };
}

// ---------------------------------------------------------------------------
// ContextSummary (engine-held rolling summary, persisted in saves)
// ---------------------------------------------------------------------------

export const contextSummarySchema = z
  .object({
    /** Running summary text (incremental continuation, never a rewrite). */
    text: z.string(),
    /** Player-turn count at which the last summary was produced (0 = none). */
    lastSummaryTurn: z.number().int().nonnegative(),
    /** Inclusive transcript-entry turn range covered by the last summary ([1,0] = none). */
    sourceTurnRange: z.tuple([z.number().int().positive(), z.number().int().nonnegative()]),
  })
  .strict();

export type ContextSummary = z.infer<typeof contextSummarySchema>;

/** Creates an empty summary state (normalize fallback for old/new saves). */
export function emptyContextSummary(): ContextSummary {
  return { text: "", lastSummaryTurn: 0, sourceTurnRange: [1, 0] };
}

// ---------------------------------------------------------------------------
// Budget estimation (no tokenizer dependency — conservative char estimate)
// ---------------------------------------------------------------------------


/** True when the current transcript+summary would overflow the injection budget. */
export function overBudget(state: WorldState, definition: WorldDefinition): boolean {
  const cfg = contextConfig(definition);
  const summary = state.contextSummary;
  const summaryChars = summary ? summary.text.length : 0;
  const transcriptChars = state.transcript.reduce((sum, e) => sum + e.text.length, 0);
  return transcriptChars + summaryChars > cfg.budget * cfg.triggerRatio;
}

/**
 * True when a summary should be produced for the current turn: either
 * SUMMARY_EVERY_TURNS player turns accumulated since the last summary
 * (or since the start for the very first summary), or the transcript+
 * summary exceeds the budget ratio. An empty transcript never triggers.
 * A "player turn" = one player input entry in the transcript.
 */
export function shouldSummarize(state: WorldState, definition: WorldDefinition): boolean {
  const cfg = contextConfig(definition);
  const playerTurns = state.transcript.filter((e) => e.role === "player").length;
  const lastSummarized = state.contextSummary?.lastSummaryTurn ?? 0;
  if (playerTurns - lastSummarized >= cfg.summaryEveryTurns) return true;
  return overBudget(state, definition);
}

// ---------------------------------------------------------------------------
// Transcript window (short-term verbatim layer)
// ---------------------------------------------------------------------------

/**
 * Selects the recent-turn transcript window (default 6 turns = up to ~12
 * entries: player + world per turn). The window anchors on the last N
 * player entries and slices from the earliest included entry through the
 * latest player entry, so the prompt reads chronologically (recency bias).
 */
export function transcriptWindow(
  state: WorldState,
  definition: WorldDefinition,
): TranscriptEntry[] {
  const cfg = contextConfig(definition);
  if (cfg.windowTurns <= 0) return [];
  const entries = state.transcript;
  const playerIdxs = entries
    .map((e, i) => (e.role === "player" ? i : -1))
    .filter((i) => i >= 0);
  if (playerIdxs.length === 0) return [];
  const startIdx = playerIdxs[Math.max(0, playerIdxs.length - cfg.windowTurns)];
  // Everything from the earliest included player entry onward belongs to
  // the recent window (world/system entries after it are part of those
  // turns and stay chronologically ordered).
  return entries.slice(startIdx);
}

/**
 * Builds the structured state snapshot block (layer B): time/location,
 * present NPCs, active tasks, and key flags — facts only. Descriptions
 * (relations/reputations/needs) are injected separately by prompt.ts via
 * the 关系与状态摘要 block, so each fact has a single home. Includes the
 * system instruction that numeric values are the only fact source and
 * descriptions are explanations.
 */
export function buildStateBlock(state: WorldState, definition: WorldDefinition): string {
  const loc = definition.locations.get(state.player.locationId);
  const parts: string[] = ["## 当前状态快照"];
  parts.push(`- 时间：${formatClock(state.clock)}`);
  parts.push(`- 地点：${loc?.name ?? state.player.locationId}`);

  const presentNpcs = [...definition.npcs.values()].filter(
    (n) => state.npcs[n.id]?.currentLocationId === state.player.locationId,
  );
  if (presentNpcs.length > 0) {
    parts.push(`- 在场 NPC：${presentNpcs.map((n) => n.name).join("、")}`);
  }

  const activeTasks = state.tasks.filter((t) => t.status === "active");
  if (activeTasks.length > 0) {
    const taskNames = activeTasks
      .map((t) => definition.tasks.get(t.taskId)?.name ?? t.taskId)
      .join("、");
    parts.push(`- 进行中的任务：${taskNames}`);
  }

  const keyFlags = state.player.flags.filter((f) => !f.startsWith("lore-")).slice(0, 8);
  if (keyFlags.length > 0) {
    parts.push(`- 关键状态标记：${keyFlags.join("、")}`);
  }

  parts.push(
    "以上状态与后续描述是引擎事实的说明，数值为唯一事实源；叙事不得与数值矛盾，描述仅为解释、不得作为新的事实来源。",
  );
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Rolling summary (layer C) — incremental continuation via generateText
// ---------------------------------------------------------------------------

/** Prompt template that forces fact retention and drops atmosphere. */
export function summaryPromptTemplate(
  definition: WorldDefinition,
  priorSummary: string,
  newEntries: TranscriptEntry[],
): { system: string; prompt: string } {
  const retainedTiers = definition.run.context_compaction.retention_tiers;
  const tierText =
    retainedTiers.length > 0
      ? `归档后参与摘要的记忆层：${retainedTiers.join("、")}`
      : "归档后参与摘要的记忆层：major";
  const system = [
    "你是游戏引擎的剧情摘要器。你只负责把最近发生的对话压缩进一份持续更新的剧情摘要（running summary），绝不修改任何数值状态，也不自行创造事实。",
    "要求：",
    "1. 必须保留：玩家当前目标/任务进度、剧情承诺、未解决线索、关系与声望变化、canonical facts（lore- 前缀事实）。",
    "2. 必须丢弃：氛围描写、重复陈述、寒暄、与剧情无关的闲谈。",
    "3. 增量续写：在旧摘要基础上追加新信息，不要重写旧摘要，不要删除旧摘要中仍然成立的内容。",
    "4. 输出只有一段摘要正文，不要输出任何其他内容。",
  ].join("\n");
  const rangeStart = newEntries.length > 0 ? newEntries[0].turn : 0;
  const rangeEnd = newEntries.length > 0 ? newEntries[newEntries.length - 1].turn : 0;
  const prompt = [
    `${tierText}`,
    `旧摘要（如为空则这是首次摘要）：\n${priorSummary || "（无）"}`,
    `本轮新增对话（第 ${rangeStart}-${rangeEnd} 回合）：`,
    ...newEntries.map((e) => `[${e.role}] ${e.text}`),
    "请输出续写后的完整摘要（含旧摘要中仍然成立的部分）。",
  ].join("\n");
  return { system, prompt };
}


/**
 * Generates (or incrementally continues) the rolling summary via
 * LLMProvider.generateText — the first consumer of that interface.
 * The output is clipped to SUMMARY_MAX_CHARS; on any failure returns null
 * (the caller degrades to the pure window — a summary failure never blocks
 * a turn).
 */
export async function summarizeContext(
  provider: LLMProvider,
  definition: WorldDefinition,
  state: WorldState,
): Promise<ContextSummary | null> {
  try {
    const cfg = contextConfig(definition);
    const prior = state.contextSummary;
    // New entries = transcript entries after the last summarized entry
    // (sourceTurnRange[1] = turn of the last covered entry; [1,0] = none).
    const lastCoveredTurn = prior && prior.sourceTurnRange[1] > 0 ? prior.sourceTurnRange[1] : 0;
    const newEntries = state.transcript.filter((e) => e.turn > lastCoveredTurn);
    if (newEntries.length === 0) {
      // Nothing new to summarize — keep the prior summary as-is.
      return prior ?? null;
    }
    const { system, prompt } = summaryPromptTemplate(
      definition,
      prior?.text ?? "",
      newEntries,
    );
    const text = await provider.generateText({ system, prompt });
    const clipped =
      text.length > cfg.summaryMaxChars ? text.slice(0, cfg.summaryMaxChars) : text;
    const firstTurn = newEntries[0].turn;
    const lastTurn = newEntries[newEntries.length - 1].turn;
    const playerTurns = state.transcript.filter((e) => e.role === "player").length;
    return {
      text: clipped,
      lastSummaryTurn: playerTurns,
      sourceTurnRange: [firstTurn, lastTurn],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer assembly (A/B/C/D/E) — used by buildTurnPrompt
// ---------------------------------------------------------------------------

export interface ContextBlocks {
  /** Layer C rolling summary block (empty string when none). */
  summaryBlock: string;
  /** Layer D transcript window (formatted chat lines). */
  transcriptBlock: string;
}

/**
 * Assembles the mid/short-term layers (C + D) for injection. Layer B
 * (state snapshot) is built by buildStateBlock; layer A (constitution)
 * stays in buildSystemPrompt; layer E is the player's input appended last.
 */
export function buildContextBlocks(
  state: WorldState,
  definition: WorldDefinition,
): ContextBlocks {
  const summary = state.contextSummary;
  const summaryBlock =
    summary && summary.text.length > 0
      ? `## 剧情摘要（此前回合的压缩记忆，非事实源；事实以状态快照为准）\n${summary.text}`
      : "";

  const window = transcriptWindow(state, definition);
  const transcriptBlock =
    window.length > 0
      ? [
          "## 最近对话（回合记录，供你保持连贯）",
          ...window.map(
            (e) =>
              `[第${e.turn}回合][${e.role === "player" ? "玩家" : e.role === "world" ? "世界" : "系统"}] ${e.text}`,
          ),
        ].join("\n")
      : "";

  return { summaryBlock, transcriptBlock };
}
