"use client";

import { useEffect, useState } from "react";
import Home from "@/app/page";
import { clearSlots } from "@/app/lib/script-registry";
import { applyTheme } from "@/app/lib/theme";
import { fixturePresentation, CORE_SCRIPT_ID } from "./core-test-script";
import { MockGamePort, type MockGameScenario } from "./mock-game-port";

const LAST_RUN_KEY = "chatgame:last-run";

export interface GamePreviewHarnessProps {
  scenario?: MockGameScenario;
  lastRun?: boolean;
}

/** Mounts the real application page with only its HTTP boundary replaced. */
export function GamePreviewHarness({ scenario = {}, lastRun = false }: GamePreviewHarnessProps) {
  const [runtime] = useState(() => {
    const port = new MockGamePort(scenario);
    const restoreFetch = port.install();
    clearSlots();
    if (lastRun) {
      localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ scriptId: CORE_SCRIPT_ID, runId: "autosave.json" }));
    } else {
      localStorage.removeItem(LAST_RUN_KEY);
    }
    applyTheme(fixturePresentation().currentTheme);
    return { port, restoreFetch };
  });

  useEffect(
    () => () => {
      runtime.restoreFetch();
      clearSlots();
      localStorage.removeItem(LAST_RUN_KEY);
    },
    [runtime],
  );

  return (
    <div data-testid="game-preview-harness" className="h-dvh min-h-0 overflow-hidden">
      <Home />
    </div>
  );
}
