// Starlight fixture integration tests: a full turn-loop slice on the second
// script — steal (opposed check), attack (combat damage), and an overpowered
// request rejection with zero state change (Done Criteria #2).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { previewAction, resolveAction } from "../actions";
import { parseIntent } from "../narrative/intent";
import { MockProvider } from "../narrative/mock";
import type { WorldState, WorldDefinition } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const STARLIGHT = path.join(REPO_ROOT, "scripts/starlight");

function setup(): { def: WorldDefinition; state: WorldState } {
  const def = loadScript(STARLIGHT);
  // crew-member starts in hab-ring; night-cat (home: hab-ring) is present.
  const { state } = generateWorld(def, "crew-member", { seed: 42 });
  return { def, state };
}

describe("starlight full turn-loop slice", () => {
  it("steal resolves as an opposed check (tie = actor fails)", () => {
    const { def, state } = setup();
    // player agility 10 + roll 10 = 20; night-cat perception 12 + roll 8 = 20.
    const out = resolveAction({
      definition: def,
      state,
      actionId: "steal",
      targetNpcId: "night-cat",
      rollOverride: 10,
      npcRollOverride: 8,
    });
    expect(out.rejected).toBe(false);
    expect(out.resolution?.resolveType).toBe("opposed_check");
    expect(out.resolution?.grade).toBe("fail");
  });

  it("attack round consumes combat damage on the target NPC", () => {
    const { def, state } = setup();
    const hpBefore = state.npcs["night-cat"].stats.hp;
    const out = resolveAction({
      definition: def,
      state,
      actionId: "attack",
      targetNpcId: "night-cat",
      rollOverride: 20, // crit: 20 + strength vs DC 12
    });
    expect(out.rejected).toBe(false);
    expect(out.state.npcs["night-cat"].stats.hp).toBeLessThan(hpBefore);
    expect(out.resolution?.effectsApplied.some((s) => s.includes("attack hit"))).toBe(true);
  });

  it("previews and executes the same dynamic reroute energy cost", () => {
    const { def, state: fresh } = setup();
    const state = { ...fresh, runtimeState: { ...fresh.runtimeState, hull_integrity: 80 } };
    const energyBefore = state.player.needs.energy.value;
    const preview = previewAction(def, state, { actionId: "reroute" });
    const out = resolveAction({ definition: def, state, actionId: "reroute" });
    expect(preview.executable).toBe(true);
    expect(preview.costs.resources).toEqual([{ kind: "need", id: "energy", amount: 20 }]);
    expect(out.rejected).toBe(false);
    expect(energyBefore - out.state.player.needs.energy.value).toBe(20);
  });

  it("overpowered request is rejected with zero state change", async () => {
    const { def, state } = setup();
    const provider = new MockProvider();
    const before = JSON.stringify(state);
    const tier = await parseIntent(provider, def, state, "我要瞬移到宝库拿走一切");
    expect(tier.tier).toBe("reject");
    expect(JSON.stringify(state)).toBe(before);
  });
});
