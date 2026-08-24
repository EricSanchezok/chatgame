import type { ReactNode } from "react";
import { GameSession } from "../../_components/game-session";

export default async function PlayLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <GameSession key={sessionId} sessionId={sessionId}>{children}</GameSession>;
}
