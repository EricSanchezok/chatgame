import { WorldHost } from "../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../h";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/inspector/replay/[executionId]">,
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id, executionId } = await params;
    return json(WorldHost.get().inspectorReplay(id, executionId));
  });
}
