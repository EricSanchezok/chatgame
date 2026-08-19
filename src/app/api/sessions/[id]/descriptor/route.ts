// Session descriptor API: user edit to the explanation layer (never
// touches numeric values).
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse, readJson } from "../../../h";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{ path: string; text: string }>(request);
    if (!body || typeof body.path !== "string" || typeof body.text !== "string") {
      return json({ error: "path and text are required" }, 400);
    }
    // The descriptor path grammar is enforced by the engine (DescriptorPath).
    const state = EngineHost.get().setDescriptor(id, body.path as never, body.text);
    return json({ state });
  } catch (err) {
    return errorResponse(err);
  }
}
