import { WorldHost } from "../../../../../server/world-host";
import { json, observedRoute } from "../../../h";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    const includePayload = new URL(request.url).searchParams.get("payload") === "true";
    return json(WorldHost.get().debugInspect(id, includePayload));
  });
}
