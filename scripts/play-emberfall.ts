// Demo CLI: end-to-end smoke for the engine runtime.
// Usage:
//   npx tsx scripts/play-emberfall.ts              # mock LLM (default)
//   CHATGAME_LLM_PROVIDER=vercel npx tsx scripts/play-emberfall.ts
//   CHATGAME_LLM_BASE_URL=... CHATGAME_LLM_API_KEY=... CHATGAME_LLM_MODEL=... npx tsx scripts/play-emberfall.ts
//
// Flow: load Emberfall -> generate world -> opening narrative -> execute one
// authoritative 12-action mine shift -> save -> reload and verify.
import path from "node:path";
import { Engine } from "../src/engine";
import { MockProvider } from "../src/engine/narrative/mock";
import { readSave } from "../src/engine/save";
import type { IntentHint } from "../src/shared/client-dto";

const SCRIPT_DIR = path.resolve(__dirname, "../scripts/emberfall");

async function main(): Promise<void> {
  const providerKind = process.env.CHATGAME_LLM_PROVIDER ?? "mock";
  console.log(`[play-emberfall] LLM provider: ${providerKind} (CHATGAME_LLM_PROVIDER=${providerKind})`);

  const provider = providerKind === "mock" ? new MockProvider() : undefined;

  // 1. Create session (deterministic seed by default).
  const seed = Number(process.env.CHATGAME_SEED ?? 42);
  const engine = Engine.create({
    scriptDir: SCRIPT_DIR,
    originId: "lamp-keeper",
    seed,
    provider,
  });
  console.log(`[play-emberfall] script=${engine.definition.script.id} origin=lamp-keeper seed=${seed}`);

  // 2. Opening narrative.
  console.log("\n=== 开场 ===\n" + engine.openingNarrative());

  // 3. Complete one deterministic public-ledger shift. Intent hints exercise
  // the same authoritative preview/turn path used by launcher quick actions.
  const turns: Array<{ text: string; hint: IntentHint }> = [
    { text: "修整公用灰灯", hint: { actionId: "trim-wick" } },
    { text: "领取本班支护", hint: { actionId: "draw-support" } },
    { text: "击鼓下井", hint: { actionId: "begin-shift" } },
    { text: "测绘上层煤缝", hint: { actionId: "survey-seam" } },
    { text: "移至回钟横巷", hint: { actionId: "mine-move", params: { target: "bell-gallery" } } },
    { text: "听辨岩层钟响", hint: { actionId: "listen-strata" } },
    { text: "移至青火煤层", hint: { actionId: "mine-move", params: { target: "blue-seam" } } },
    { text: "采集本班炉煤", hint: { actionId: "collect-coal" } },
    { text: "起取旧班签", hint: { actionId: "recover-token" } },
    { text: "收班返镇", hint: { actionId: "return-shift" } },
    { text: "记录韩直的钟房证词", hint: { actionId: "record-testimony", target: "han-zhi" } },
    { text: "公开配给诊所", hint: { actionId: "allocate-coal", params: { allocation: "clinic" } } },
  ];

  for (const { text, hint } of turns) {
    const preview = engine.previewAction(hint);
    if (!preview.executable) {
      throw new Error(`${hint.actionId} preview rejected: ${preview.reason ?? preview.reasonCode ?? "unknown"}`);
    }
    console.log(`\n--- 玩家：${text} ---`);
    const result = await engine.playerTurn({ text, intentHint: hint });
    if (result.rejection) throw new Error(`${hint.actionId} rejected: ${result.rejection.narrative}`);
    console.log(result.narrative);
    if (result.resolution) {
      console.log(`[判定] ${result.resolution.actionId} → ${result.resolution.grade} (roll=${result.resolution.roll ?? "-"}/dc=${result.resolution.dc ?? "-"})`);
      for (const summary of result.resolution.effectsApplied) console.log(`[结算] ${summary}`);
    }
  }

  // 4. World snapshot after turns.
  const state = engine.worldState;
  console.log("\n=== 世界状态摘要 ===");
  console.log(`时间：${state.clock.year}年${state.clock.month}月${state.clock.day}日 ${state.clock.hour}:00`);
  console.log(`位置：${engine.definition.locations.get(state.player.locationId)?.name ?? state.player.locationId}`);
  console.log(`阶段：${String(state.runtimeState.phase)}  灯火：${String(state.runtimeState.lamp)}`);
  console.log(`公炉煤：${String(state.runtimeState.publicFurnace)}  诊所煤：${String(state.runtimeState.clinicCoal)}`);
  console.log(`证据：${state.facts.filter((fact) => fact.startsWith("evidence:") || fact.startsWith("conclusion:")).join("、")}`);
  console.log(`结算次数：${String(state.runtimeState.settlementCount)}`);
  console.log(`事件日志：${state.eventLog.length} 条`);

  const complete = state.runtimeState.phase === "settled"
    && state.runtimeState.settlementCount === 1
    && state.runtimeState.clinicCoal === 8
    && state.runtimeState.carriedCoal === 0
    && state.player.locationId === "lamp-house"
    && state.facts.includes("evidence:seam-sample")
    && state.facts.includes("evidence:bell-testimony")
    && state.facts.includes("conclusion:unlogged-second-descent");
  if (!complete) throw new Error("the authoritative Emberfall shift did not reach its settled evidence state");

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
