import { WorldHost } from "../../../../../server/world-host";
import { json, observedRoute } from "../../../h";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/observer">,
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    const agentId = new URL(request.url).searchParams.get("agentId")?.trim() || undefined;
    return json(WorldHost.get().observer(id, agentId));
  });
}
