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

  return parts.join("\n");
}

/** Builds the player-facing prompt for a narrative turn. */
export function buildTurnPrompt(input: PromptInput): string {
  const { definition, state, playerInput, npcId } = input;
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

  parts.push(`\n## 玩家输入`);
  parts.push(playerInput);

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
