import { WorldHost, WorldHostError } from "../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../h";

type Context = { params: Promise<{ id: string; revision: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, revision: rawRevision } = await context.params;
    if (!/^[1-9]\d*$/.test(rawRevision)) throw new WorldHostError("revision must be a positive safe integer", 400);
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision)) throw new WorldHostError("revision must be a positive safe integer", 400);
    return json(WorldHost.get().inspectorStep(id, revision, {
      ...scope.correlation,
      sessionId: id,
      revision,
      step: revision,
    }));
  });
}
