import { WorldWorkspace } from "../../_components/world-workspace";

export default async function WorldPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return <WorldWorkspace selectedWorldId={worldId} />;
}
