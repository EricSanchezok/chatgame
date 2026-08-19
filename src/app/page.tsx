"use client";

// Top-level page: routes between the launcher and the game screen based on
// the session state. GameProvider wraps everything so both screens share
// one state owner. The root fills the viewport shell (h-dvh) and keeps the
// only scrolling regions inside each screen (launcher main / game stage).

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
      <div className="flex h-full min-h-0 flex-col">
        <Router />
      </div>
    </GameProvider>
  );
}
