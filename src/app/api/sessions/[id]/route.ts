import { WorldHost } from "../../../../server/world-host";
import { json, observedRoute } from "../../h";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await context.params;
    return json(WorldHost.get().session(id, { ...scope.correlation, sessionId: id }));
  });
}
