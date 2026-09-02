import { WorldHost } from "../../../../../server/world-host";
import { json, observedRoute } from "../../../h";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hash: string }> },
): Promise<Response> {
  return observedRoute(request, async () => {
    const { hash } = await params;
    return json(WorldHost.get().debugArtifact(hash));
  });
}
