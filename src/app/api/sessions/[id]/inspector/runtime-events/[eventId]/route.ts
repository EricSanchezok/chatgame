import { WorldHost, WorldHostError } from "../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../h";

type Context = { params: Promise<{ id: string; eventId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, eventId } = await context.params;
    if (!/^runtime-[a-f0-9]{64}$/.test(eventId)) {
      throw new WorldHostError("runtime event id is invalid", 400);
    }
    return json(WorldHost.get().inspectorRuntimeEvent(id, eventId, {
      ...scope.correlation,
      sessionId: id,
    }));
  });
}
