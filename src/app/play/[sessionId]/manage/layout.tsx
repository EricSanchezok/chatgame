import type { ReactNode } from "react";
import { GameManagementOverlay } from "../../../_components/game-management-overlay";

export default async function ManageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <GameManagementOverlay sessionId={sessionId}>{children}</GameManagementOverlay>;
}
