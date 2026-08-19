"use client";

// Top-level page: routes between the launcher and the game screen based on
// the session state. GameProvider wraps everything so both screens share
// one state owner.

import { GameProvider, useGame } from "./ui/game/state";
import { Launcher } from "./ui/launcher";
import { GameScreen } from "./ui/game/chat";

function Router() {
  const { state } = useGame();
  return state.screen === "game" ? <GameScreen /> : <Launcher />;
}

export default function Home() {
  return (
    <GameProvider>
      <Router />
    </GameProvider>
  );
}
