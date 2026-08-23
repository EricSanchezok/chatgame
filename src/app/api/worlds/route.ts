import { WorldHost } from "../../../server/world-host";
import { json, observedRoute } from "../h";

export async function GET(
  request = new Request("http://local/api/worlds"),
): Promise<Response> {
  return observedRoute(request, () => {
    return json({ worlds: WorldHost.get().listWorlds() });
  });
}
