// Prompt builder: assembles the system prompt + user prompt for the LLM
// from the world definition and current state. The single source of truth
// for narrative context — constitution, style, glossary, lore, memories,
// knowledge filter (anti-spoiler), taboos (hard/soft), descriptors.
import type { WorldState } from "../types";
import type { WorldDefinition } from "../types";
import { summarizeForInjection } from "../memory";
import { revealableSecrets } from "../plot";
import { formatClock } from "../time";

export interface PromptInput {
  definition: WorldDefinition;
  state: WorldState;
  /** The player's latest free-text input. */
  playerInput: string;
  /** NPC currently speaking (for knowledge filtering + persona). */
  npcId?: string;
  /** Action being resolved this turn (drives the llm_freedom guidance). */
  actionId?: string;
}

/** Builds the system prompt (world constitution + style + safety). */
export function buildSystemPrompt(def: WorldDefinition): string {
  const world = def.world;
  const style = def.narrative.style;
  const parts: string[] = [];

  parts.push(`# 世界设定：${def.script.name}`);
  parts.push(world.background.trim());

  if (world.glossary && world.glossary.length > 0) {
    parts.push("\n## 术语表");
    for (const g of world.glossary) {
      parts.push(`- ${g.term}（${g.aliases.join("/")}）：${g.definition}`);
    }
  }

  parts.push("\n## 世界规则（必须遵守）");
  for (const rule of world.rules) {
    parts.push(`- ${rule.text}`);
  }

  parts.push("\n## 叙事禁忌（违反即被拒绝）");
  for (const taboo of world.taboos) {
    parts.push(`- [${taboo.severity.toUpperCase()}] ${taboo.text}`);
  }

  parts.push("\n## 文风");
  if (style.voice) parts.push(`- 叙述声音：${style.voice}`);
  parts.push(`- 视角：${style.perspective}；时态：${style.tense}；描写密度：${style.density}`);
  parts.push(`- 句式：${style.sentence_style.join("、") || "自然流畅"}`);
  if (style.forbidden_words.length > 0) {
    parts.push(`- 禁用词：${style.forbidden_words.join("、")}`);
  }

  // Lore entries marked "always" get injected into the system prompt.
  const alwaysLore = def.narrative.lore.filter((l) => l.inject_when === "always");
  if (alwaysLore.length > 0) {
    parts.push("\n## 设定资料（常驻）");
    for (const l of alwaysLore) {
      parts.push(`- ${l.content}`);
    }
  }
  // Content boundaries: script-declared safety contract, engine-enforced.
  const safety = def.safety;
  const allowedList = Object.entries(safety.allowed)
    .filter(([, intensity]) => intensity !== "none")
    .map(([contentClass, intensity]) => `${contentClass}=${intensity}`)
    .join("、");
  const forbiddenList = safety.forbidden.join("、");
  parts.push("\n## 内容边界（必须遵守）");
  parts.push(`- 本作品分级：${safety.age_rating}`);
  parts.push(`- 允许的内容强度：${allowedList || "无"}`);
  parts.push(`- 禁止的内容：${forbiddenList || "无"}`);

  return parts.join("\n");
}

/**
 * Returns the llm_freedom guidance block for an action, or "" when the
 * action id is unknown. The LLM never adjudicates mechanics — it narrates.
 */
export function buildActionFreedomBlock(actionId: string, def: WorldDefinition): string {
  const action = def.actions.actions.find((a) => a.id === actionId);
  if (!action) return "";

  const guidance: Record<typeof action.llm_freedom, string> = {
    narration:
      "本动作允许自由叙事：按动作意图充分展开情节。机制由引擎结算，你只负责叙事。",
    process:
      "本动作只叙述机械流程的结果，不得虚构机制细节。机制由引擎结算，你只负责叙事。",
    result:
      "本动作只叙述最终结果，不展开过程。机制由引擎结算，你只负责叙事。",
  };
  return `## 当前动作\n${guidance[action.llm_freedom]}`;
}

/** Builds the player-facing prompt for a narrative turn. */
export function buildTurnPrompt(input: PromptInput): string {
  const { definition, state, playerInput, npcId, actionId } = input;
  const parts: string[] = [];

  parts.push(`## 当前时间：${formatClock(state.clock)}`);
  parts.push(`## 玩家位置：${definition.locations.get(state.player.locationId)?.name ?? state.player.locationId}`);

  if (npcId) {
    const npcDef = definition.npcs.get(npcId);
    const npcState = state.npcs[npcId];
    if (npcDef && npcState) {
      parts.push(`\n## 当前对话对象：${npcDef.name}`);
      parts.push(`性格：${npcDef.llm.personality}`);
      if (npcDef.llm.speech_patterns.length > 0) {
        parts.push(`说话习惯：${npcDef.llm.speech_patterns.join("；")}`);
      }
      // Knowledge filter: only reveal secrets the player may know.
      if (npcDef.llm.knowledge_filter) {
        const known = revealableSecrets(state, definition, npcId);
        if (known.length > 0) {
          parts.push(`可以透露的秘密：${known.join("、")}`);
        }
      }
      // Memory injection (deterministic top-k).
      const memoryText = summarizeForInjection(npcState, 8);
      if (memoryText) {
        parts.push(`\n该角色的记忆：\n${memoryText}`);
      }
    }
  }

  // Lorebook injection: on_keyword (player input), on_location (player's
  // current location), on_npc (NPC present at the player's location).
  const playerLoc = state.player.locationId;
  const presentNpcs = [...definition.npcs.values()].filter(
    (n) => state.npcs[n.id]?.currentLocationId === playerLoc,
  );
  const injectableLore = definition.narrative.lore.filter((l) => {
    if (l.inject_when === "always") return false; // already in the system prompt
    if (l.inject_when === "on_keyword") {
      return l.keywords.some((k) => playerInput.includes(k));
    }
    if (l.inject_when === "on_location") {
      return l.locations?.includes(playerLoc) ?? false;
    }
    if (l.inject_when === "on_npc") {
      return l.npcs?.some((id) => presentNpcs.some((n) => n.id === id)) ?? false;
    }
    return false;
  });
  if (injectableLore.length > 0) {
    parts.push("\n## 相关设定");
    for (const l of injectableLore) {
      parts.push(`- ${l.content}`);
    }
  }

  // Few-shot dialogue examples: match the NPC's dialogue_examples reference
  // or the generic example set.
  if (npcId) {
    const npcDef = definition.npcs.get(npcId);
    const exampleId = npcDef?.llm.dialogue_examples;
    const example =
      definition.narrative.examples.find((e) => e.npc_id === npcId) ??
      (exampleId ? definition.narrative.examples.find((e) => e.npc_id === exampleId) : undefined) ??
      definition.narrative.examples.find((e) => e.npc_id === "generic");
    if (example) {
      parts.push("\n## 对话示例");
      for (const ex of example.exchanges) {
        parts.push(`玩家：${ex.player}\n${npcDef?.name ?? "对方"}：${ex.npc}`);
      }
    }
  }

  parts.push(`\n## 玩家输入`);
  parts.push(playerInput);

  if (actionId) {
    const freedomBlock = buildActionFreedomBlock(actionId, definition);
    if (freedomBlock) {
      parts.push(`\n${freedomBlock}`);
    }
  }
  parts.push("\n## 输出要求");
  parts.push(
    "只叙述玩家能感知到的结果；数值变化交给引擎处理，不要在文字中伪造状态（如血量、物品、关系数值）。",
  );

  return parts.join("\n");
}

/** Builds the prompt for intent parsing (player text -> structured action). */
export function buildIntentPrompt(
  def: WorldDefinition,
  state: WorldState,
  playerInput: string,
): { system: string; prompt: string } {
  const available = def.actions.actions
    .filter((a) => a.enabled)
    .map((a) => `${a.id}${a.display_name ? `（${a.display_name}）` : ""}`)
    .join(", ");
  const system = [
    "你是游戏意图解析器。把玩家自由文本映射为结构化动作。",
    "规则：",
    "1. 只能从可用动作中选择；无法映射时选 talk。",
    "2. 目标 target 填玩家提到的人物 id 或物品 id；没有则留空。",
    "3. 明显超模/不可能的动作（瞬移、凭空造物）必须拒绝：选 talk 且 reject=true。",
    "可用动作：" + available,
  ].join("\n");
  const prompt = `玩家当前位置：${state.player.locationId}\n玩家输入：${playerInput}`;
  return { system, prompt };
}
