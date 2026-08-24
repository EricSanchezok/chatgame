"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PublicSessionSummary } from "../../shared/world-api";
import {
  parsePreferences,
  preferencesSnapshot,
  serverPreferencesSnapshot,
  subscribePreferences,
} from "../_lib/browser-state";
import { ControlOrb, type ControlOrbPhase } from "./control-orb";
import { GameSessionProvider } from "./game-session-context";
import { GameThread, type WorldRunActions } from "./game-thread";

const WorldInspectorDialog = dynamic(() => import("./world-inspector-dialog"), {
  ssr: false,
});

interface GameSessionSurfaceProps {
  actionError: string;
  awaitingPlayer: boolean;
  cancelPending: boolean;
  children?: ReactNode;
  composerDocked: boolean;
  confirmationPending: boolean;
  interactionPending: boolean;
  onNavigate: (href: string) => void;
  orbPhase: ControlOrbPhase;
  runActions: WorldRunActions;
  session: PublicSessionSummary;
  sessionId: string;
  streamWarning: string;
  updateSession: (session: PublicSessionSummary) => void;
}

export function GameSessionSurface({
  actionError,
  awaitingPlayer,
  cancelPending,
  children,
  composerDocked,
  confirmationPending,
  interactionPending,
  onNavigate,
  orbPhase,
  runActions,
  session,
  sessionId,
  streamWarning,
  updateSession,
}: GameSessionSurfaceProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const serializedPreferences = useSyncExternalStore(
    subscribePreferences,
    preferencesSnapshot,
    serverPreferencesSnapshot,
  );
  const preferences = useMemo(() => parsePreferences(serializedPreferences), [serializedPreferences]);

  useEffect(() => subscribePreferences(() => {
    if (!parsePreferences(preferencesSnapshot()).showWorldInspector) {
      setInspectorOpen(false);
    }
  }), []);

  return (
    <GameSessionProvider value={{ interactionPending, session, updateSession }}>
      <main className="cg-game">
        <h1 className="cg-sr-only">{session.title}</h1>
        <GameThread
          actionError={actionError}
          awaitingPlayer={awaitingPlayer}
          cancelPending={cancelPending}
          confirmationPending={confirmationPending}
          runActions={runActions}
          streamWarning={streamWarning}
        />
        <ControlOrb
          composerDocked={composerDocked}
          inspectorEnabled={preferences.showWorldInspector}
          onNavigate={onNavigate}
          onOpenInspector={() => setInspectorOpen(true)}
          sessionId={sessionId}
          status={{
            elapsedSeconds: session.elapsedSeconds,
            phase: orbPhase,
            sessionTitle: session.title,
            step: session.step,
            worldName: session.world.name,
          }}
        />
        {children}
        {preferences.showWorldInspector && inspectorOpen ? (
          <WorldInspectorDialog
            key={sessionId}
            onOpenChange={setInspectorOpen}
            open={inspectorOpen}
            reduceMotion={preferences.reduceMotion}
            sessionId={sessionId}
          />
        ) : null}
      </main>
    </GameSessionProvider>
  );
}
