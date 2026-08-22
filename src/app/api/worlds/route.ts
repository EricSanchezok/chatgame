import { WorldHost } from "../../../server/world-host";
import { errorResponse, json } from "../h";

export async function GET(): Promise<Response> {
  try {
    return json({ worlds: WorldHost.get().listWorlds() });
  } catch (error) {
    return errorResponse(error);
  }
}
