// Session state API: full world state + presentation surface.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse } from "../../../h";
import { completePresentation } from "../../../script-presentation";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const host = EngineHost.get();
    const snapshot = host.sessionSnapshot(id);
    return json({
      id,
      ...snapshot,
      presentation: await completePresentation(host, snapshot.state.scriptId, snapshot.presentation),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
