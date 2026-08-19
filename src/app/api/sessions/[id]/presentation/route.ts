// Session presentation API: selectable themes + current theme.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse } from "../../../h";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return json(EngineHost.get().sessionPresentation(id));
  } catch (err) {
    return errorResponse(err);
  }
}
