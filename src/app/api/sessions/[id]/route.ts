import { WorldHost } from "../../../../server/world-host";
import { errorResponse, json } from "../../h";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    return json(WorldHost.get().session(id));
  } catch (error) {
    return errorResponse(error);
  }
}
