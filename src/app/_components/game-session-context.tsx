"use client";

import { createContext, useContext } from "react";
import type { PublicSessionSummary } from "../../shared/world-api";

interface GameSessionContextValue {
  interactionPending: boolean;
  session: PublicSessionSummary;
  updateSession: (session: PublicSessionSummary) => void;
}

const GameSessionContext = createContext<GameSessionContextValue | undefined>(undefined);

export const GameSessionProvider = GameSessionContext.Provider;

export function useGameSession(): GameSessionContextValue {
  const value = useContext(GameSessionContext);
  if (!value) throw new Error("useGameSession must be used inside GameSessionProvider");
  return value;
}
