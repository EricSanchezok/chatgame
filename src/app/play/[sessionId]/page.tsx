import { GameSession } from "../../_components/game-session";

export default async function PlayPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <GameSession key={sessionId} sessionId={sessionId} />;
}
