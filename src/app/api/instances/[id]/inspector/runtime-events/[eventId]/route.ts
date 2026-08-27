import { WorldHost } from "../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../h";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/inspector/runtime-events/[eventId]">,
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id, eventId } = await params;
    return json(WorldHost.get().inspectorRuntimeEvent(id, eventId));
  });
}
