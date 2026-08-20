import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@/app/lib/api";
import { createGameStore, GameController } from "@/app/lib/game-store";
import {
  ALT_SCRIPT_ID,
  CORE_SCRIPT_ID,
  createFixtureWorld,
  fixturePresentation,
} from "./core-test-script";
import { MockGamePort } from "./mock-game-port";

describe("GameController generation contract", () => {
  it("commits world, theme and bundle descriptor from one script generation", async () => {
    const port = new MockGamePort({
      latencyMs: { [`/api/scripts/${CORE_SCRIPT_ID}`]: 50 },
    });
    const store = createGameStore();
    const controller = new GameController(store, port);

    const staleStart = controller.startNewGame(CORE_SCRIPT_ID, "observer");
    const freshStart = controller.startNewGame(ALT_SCRIPT_ID, "observer");
    await Promise.all([staleStart, freshStart]);

    const state = store.getSnapshot();
    expect(state.requestGeneration).toBe(2);
    expect({
      sessionScript: state.session?.scriptId,
      worldScript: state.session?.state.scriptId,
      detailScript: state.detail?.scriptId,
      theme: state.session?.presentation.currentTheme.id,
      defaultTheme: state.session?.presentation.defaultThemeId,
      bundle: state.session?.presentation.uiBundle?.url,
    }).toEqual({
      sessionScript: ALT_SCRIPT_ID,
      worldScript: ALT_SCRIPT_ID,
      detailScript: ALT_SCRIPT_ID,
      theme: "workbench-alt",
      defaultTheme: "workbench-alt",
      bundle: `/api/scripts/${ALT_SCRIPT_ID}/ui-bundle`,
    });
  });

  it("does not let an older turn replace a newer session presentation", async () => {
    const port = new MockGamePort();
    const store = createGameStore();
    const controller = new GameController(store, port);
    await controller.startNewGame(CORE_SCRIPT_ID, "observer");

    port.scenario.latencyMs = { "/api/sessions/preview-session/turn": 50 };
    const staleTurn = controller.submitTurn("检查旧剧本线路");
    const freshStart = controller.startNewGame(ALT_SCRIPT_ID, "observer");
    await Promise.all([staleTurn, freshStart]);

    const state = store.getSnapshot();
    expect(state.lastTurn).toBeNull();
    expect(state.session?.state.scriptId).toBe(ALT_SCRIPT_ID);
    expect(state.session?.presentation.currentTheme.id).toBe("workbench-alt");
    expect(state.session?.presentation.uiBundle?.dependencyHash).toBe(`${ALT_SCRIPT_ID}-workbench`);
  });

  it("commits advance location and presentation as one snapshot", async () => {
    const port = new MockGamePort();
    const store = createGameStore();
    const controller = new GameController(store, port);
    await controller.startNewGame(CORE_SCRIPT_ID, "observer");

    await controller.advance(24);

    const session = store.getSnapshot().session;
    expect(session?.state.player.locationId).toBe("service-corridor");
    expect(session?.presentation.currentTheme.id).toBe("workbench-corridor");
    expect(session?.presentation.currentTheme.effects.scene_tint).toBe("#172033");
    expect(session?.presentation.defaultThemeId).toBe("workbench-core");
  });

  it("does not let an obsolete advance snapshot replace a newer generation", async () => {
    const port = new MockGamePort();
    let resolveAdvance!: (snapshot: SessionSnapshot) => void;
    vi.spyOn(port, "advance").mockImplementationOnce(
      () => new Promise<SessionSnapshot>((resolve) => { resolveAdvance = resolve; }),
    );
    const store = createGameStore();
    const controller = new GameController(store, port);
    await controller.startNewGame(CORE_SCRIPT_ID, "observer");

    const staleAdvance = controller.advance(24);
    await Promise.resolve();
    await controller.startNewGame(ALT_SCRIPT_ID, "observer");
    const staleState = createFixtureWorld(CORE_SCRIPT_ID);
    staleState.player.locationId = "service-corridor";
    resolveAdvance({
      state: staleState,
      presentation: fixturePresentation(CORE_SCRIPT_ID, "service-corridor"),
    });
    await staleAdvance;

    const session = store.getSnapshot().session;
    expect(store.getSnapshot().requestGeneration).toBe(2);
    expect(session?.state.scriptId).toBe(ALT_SCRIPT_ID);
    expect(session?.state.player.locationId).toBe("relay-room");
    expect(session?.presentation.currentTheme.id).toBe("workbench-alt");
  });

  it("previews and submits a typed action hint through the real GamePort capability", async () => {
    const port = new MockGamePort();
    const submit = vi.spyOn(port, "submitTurn");
    const store = createGameStore();
    const controller = new GameController(store, port);
    await controller.startNewGame(CORE_SCRIPT_ID, "observer");

    const hint = { actionId: "talk", target: "operator" };
    const preview = await controller.previewAction(hint);
    expect(preview).toMatchObject({ actionId: "talk", executable: true });
    expect(store.getSnapshot().operation).toBe("idle");
    await controller.submitTurn("询问信号", hint);
    expect(submit).toHaveBeenCalledWith(
      "preview-session",
      { text: "询问信号", intentHint: hint },
      expect.any(AbortSignal),
    );
  });

  it("does not start save, advance or descriptor writes while a turn owns the generation", async () => {
    const port = new MockGamePort();
    const save = vi.spyOn(port, "save");
    const advance = vi.spyOn(port, "advance");
    const descriptor = vi.spyOn(port, "setDescriptor");
    const store = createGameStore();
    const controller = new GameController(store, port);
    await controller.startNewGame(CORE_SCRIPT_ID, "observer");
    port.scenario.latencyMs = { "/api/sessions/preview-session/turn": 30 };

    const turn = controller.submitTurn("等待中的回合");
    await Promise.all([controller.save(), controller.advance(1), controller.updateDescriptor("player.name", "x")]);
    expect(save).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(descriptor).not.toHaveBeenCalled();
    await turn;
  });
});
