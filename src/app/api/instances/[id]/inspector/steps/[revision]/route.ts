import { WorldHost } from "../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../h";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/inspector/steps/[revision]">,
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id, revision: rawRevision } = await params;
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision < 1) return json({ error: "invalid revision" }, 400);
    return json(WorldHost.get().inspectorStep(id, revision));
  });
}
