"use client";

import { useEffect, useState } from "react";
import type { GameControllerEffects } from "@/app/lib/game-store";
import { defaultPlayerSettings, SETTINGS_STORAGE_KEY, writePlayerSettings } from "@/app/lib/settings";
import { clearSlots } from "@/app/lib/script-registry";
import { applyTheme } from "@/app/lib/theme";
import { GameScreen } from "@/app/ui/game/chat";
import { GameProvider, useGameSelector } from "@/app/ui/game/state";
import { Launcher } from "@/app/ui/launcher";
import { fixturePresentation } from "./core-test-script";
import { MockGamePort, type MockGameScenario } from "./mock-game-port";

export interface GamePreviewHarnessProps {
  scenario?: MockGameScenario;
}

function PreviewRouter() {
  const screen = useGameSelector((state) => state.screen);
  return screen === "game" ? <GameScreen /> : <Launcher />;
}

/** Mounts the real application screens with the formal GamePort injected. */
export function GamePreviewHarness({ scenario = {} }: GamePreviewHarnessProps) {
  const [runtime] = useState(() => {
    const port = new MockGamePort(scenario);
    const effects: GameControllerEffects = {
      onAudioEnabled: () => undefined,
      onTurn: () => undefined,
      onSessionCleanupError: () => undefined,
      onExit: () => undefined,
    };
    clearSlots();
    writePlayerSettings({
      ...defaultPlayerSettings,
    });
    applyTheme(fixturePresentation().currentTheme);
    return { port, effects };
  });

  useEffect(
    () => () => {
      clearSlots();
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      writePlayerSettings(defaultPlayerSettings);
    },
    [runtime],
  );

  return (
    <div data-testid="game-preview-harness" className="h-dvh min-h-0 overflow-hidden">
      <GameProvider port={runtime.port} effects={runtime.effects}>
        <div className="flex h-full min-h-0 flex-col">
          <PreviewRouter />
        </div>
      </GameProvider>
    </div>
  );
}
