import { WorldHost } from "../../../../server/world-host";
import { json, observedRoute } from "../../h";

export async function POST(request: Request): Promise<Response> {
  return observedRoute(request, async () =>
    json(await WorldHost.get().refreshModelRegistry()));
}
