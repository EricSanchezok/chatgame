import type { ReleaseParticipantInput } from "../../../../../../../shared/world-api";
import { WorldHost } from "../../../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../../../h";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/participants/[participantId]/release">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, participantId } = await params;
    const body = await readJson<ReleaseParticipantInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || !Number.isSafeInteger(body.expectedRevision) || !["model", "idle"].includes(body.disposition)) {
      return json({ error: "invalid release request" }, 400);
    }
    return json(await WorldHost.get().releaseParticipant(id, participantId, body, principalId(request)));
  });
}
