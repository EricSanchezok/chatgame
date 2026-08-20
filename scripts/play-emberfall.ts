// Demo CLI: end-to-end smoke for the engine runtime.
// Usage:
//   npx tsx scripts/play-emberfall.ts              # mock LLM (default)
//   CHATGAME_LLM_PROVIDER=vercel npx tsx scripts/play-emberfall.ts
//   CHATGAME_LLM_BASE_URL=... CHATGAME_LLM_API_KEY=... CHATGAME_LLM_MODEL=... npx tsx scripts/play-emberfall.ts
//
// Flow: load emberfall -> generate world -> opening narrative ->
// fixed turns (talk / move / steal opposed / cheat reject / attack combat /
// rest) -> save to .chatgame/saves/emberfall/ -> reload and verify.
import path from "node:path";
import { Engine } from "../src/engine";
import { MockProvider } from "../src/engine/narrative/mock";
import { readSave } from "../src/engine/save";

const SCRIPT_DIR = path.resolve(__dirname, "../scripts/emberfall");

async function main(): Promise<void> {
  const providerKind = process.env.CHATGAME_LLM_PROVIDER ?? "mock";
  console.log(`[play-emberfall] LLM provider: ${providerKind} (CHATGAME_LLM_PROVIDER=${providerKind})`);

  // Mock provider with a deterministic intent handler so the demo really
  // exercises opposed (steal) and combat (attack) resolution instead of
  // degrading every turn to talk.
  const provider =
    providerKind === "mock"
      ? new MockProvider({
          onGenerateObject: (prompt) => {
            if (prompt.includes("偷")) return { actionId: "steal", target: "elara" };
            if (prompt.includes("攻击") || prompt.includes("拔剑")) {
              return { actionId: "attack", target: "elara" };
            }
            if (prompt.includes("去酒馆") || prompt.includes("酒馆")) {
              return { actionId: "travel", target: "tavern" };
            }
            if (prompt.includes("休息")) return { actionId: "rest" };
            return { actionId: "talk" };
          },
        })
      : undefined;

  // 1. Create session (deterministic seed by default).
  const seed = Number(process.env.CHATGAME_SEED ?? 42);
  const engine = Engine.create({
    scriptDir: SCRIPT_DIR,
    originId: "miner",
    seed,
    provider,
  });
  console.log(`[play-emberfall] script=${engine.definition.script.id} origin=miner seed=${seed}`);

  // 2. Opening narrative.
  console.log("\n=== 开场 ===\n" + engine.openingNarrative());

  // 3. Fixed turns: talk -> move to tavern (elara present) -> steal (opposed)
  // -> cheat reject -> attack (combat) -> rest.
  const turns = [
    "你好，艾拉",
    "我去酒馆坐坐",
    "我要偷艾拉的东西",
    "我要瞬移到宝库拿走一切", // cheat gate
    "我拔出剑攻击艾拉",
    "我休息一下",
  ];

  for (const input of turns) {
    console.log(`\n--- 玩家：${input} ---`);
    const result = await engine.playerTurn({ text: input });
    console.log(result.narrative);
    if (result.resolution) {
      console.log(`[判定] ${result.resolution.actionId} → ${result.resolution.grade} (roll=${result.resolution.roll ?? "-"}/dc=${result.resolution.dc ?? "-"})`);
      const combat = result.resolution.effectsApplied.find((s) => s.startsWith("attack hit") || s.startsWith("attack missed") || s.startsWith("moved") || s.startsWith("defend"));
      if (combat) console.log(`[战斗] ${combat}`);
    }
    if (result.fellBackToTalk) {
      console.log("（已降级为普通交谈）");
    }
  }

  // 4. World snapshot after turns.
  const state = engine.worldState;
  console.log("\n=== 世界状态摘要 ===");
  console.log(`时间：${state.clock.year}年${state.clock.month}月${state.clock.day}日 ${state.clock.hour}:00`);
  console.log(`位置：${engine.definition.locations.get(state.player.locationId)?.name ?? state.player.locationId}`);
  console.log(`生命：${state.player.stats.hp}  金币：${state.player.inventory.currency}`);
  const elaraHp = state.npcs.elara?.stats.hp;
  console.log(`艾拉生命：${elaraHp ?? "-"}`);
  console.log(`事件日志：${state.eventLog.length} 条`);

  // 5. Save + reload verification.
  const savePath = engine.save("play-emberfall-demo");
  console.log(`\n[存档] ${savePath}`);
  const reloaded = readSave(savePath, "emberfall");
  const same = JSON.stringify(reloaded.worldState) === JSON.stringify(state);
  console.log(`[读档] ${same ? "OK：状态一致" : "FAIL：状态不一致"}`);

  if (!same) {
    process.exitCode = 1;
    return;
  }
  console.log("\n[play-emberfall] 冒烟通过 ✅");
}

main().catch((err) => {
  console.error("[play-emberfall] 失败：", err);
  process.exitCode = 1;
});
