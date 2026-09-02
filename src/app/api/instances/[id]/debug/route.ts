import type { DebugModeInput } from "../../../../../shared/world-api";
import { WorldHost } from "../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../h";

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/debug">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<DebugModeInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.enabled !== "boolean" ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
      return json({ error: "invalid debug mode request" }, 400);
    }
    return json(await WorldHost.get().setDebugMode(id, body, principalId(request)));
  });
}
