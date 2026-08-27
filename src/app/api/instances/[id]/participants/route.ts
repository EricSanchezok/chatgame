import type { CreateParticipantInput } from "../../../../../shared/world-api";
import { WorldHost } from "../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../h";

export async function POST(request: Request, { params }: RouteContext<"/api/instances/[id]/participants">): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<CreateParticipantInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || !Number.isSafeInteger(body.expectedRevision) ||
      typeof body.displayName !== "string" || typeof body.appearance !== "string" ||
      typeof body.motivation !== "string" || Boolean(body.originId) === Boolean(body.claimAgentId)) {
      return json({ error: "choose exactly one Origin or claimable Agent" }, 400);
    }
    return json(await WorldHost.get().createParticipant(id, body, principalId(request)), 201);
  });
}
