import { WorldHost } from "../../../../../server/world-host";
import { json, observedRoute } from "../../../h";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/worlds/[id]/start-options">,
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    return json(WorldHost.get().worldStartOptions(id));
  });
}
