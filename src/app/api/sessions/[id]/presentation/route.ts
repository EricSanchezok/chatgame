// Session presentation API: selectable themes + current theme.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse } from "../../../h";
import { completeSessionPresentation } from "../../../script-presentation";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const host = EngineHost.get();
    return json(await completeSessionPresentation(host, id));
  } catch (err) {
    return errorResponse(err);
  }
}
