// Session state API: full world state + presentation surface.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse } from "../../../h";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const host = EngineHost.get();
    return json({
      id,
      state: host.state(id),
      presentation: host.sessionPresentation(id),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
