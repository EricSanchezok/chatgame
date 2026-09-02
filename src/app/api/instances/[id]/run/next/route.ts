import type { DebugNextInput } from "../../../../../../shared/world-api";
import { WorldHost } from "../../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../../h";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/run/next">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<DebugNextInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.runId !== "string" || !body.runId.trim() ||
      typeof body.checkpointId !== "string" || !body.checkpointId.trim() ||
      typeof body.requestId !== "string" || !body.requestId.trim() ||
      !Number.isSafeInteger(body.generation) || body.generation < 1) {
      return json({ error: "invalid debug next-step request" }, 400);
    }
    return json(await WorldHost.get().advanceDebugStep(id, body, principalId(request)));
  });
}
