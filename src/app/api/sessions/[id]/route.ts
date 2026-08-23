import { WorldHost } from "../../../../server/world-host";
import { errorResponse, json, readJson } from "../../h";

type Context = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: Context,
): Promise<Response> {
  try {
    const { id } = await context.params;
    return json(WorldHost.get().session(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson<{ title?: unknown }>(request);
    if (!body || typeof body.title !== "string") {
      return json({ error: "title is required" }, 400);
    }
    return json(WorldHost.get().renameSession(id, body.title));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    WorldHost.get().deleteSession(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
