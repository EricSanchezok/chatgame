import { WorldHost } from "../../../server/world-host";
import { json, observedRoute } from "../h";

export async function GET(
  request: Request,
): Promise<Response> {
  return observedRoute(request, () => {
    return json({ worlds: WorldHost.get().listWorlds() });
  });
}
