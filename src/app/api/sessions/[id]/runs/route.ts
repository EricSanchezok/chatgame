import { WorldHost } from "../../../../../server/world-host";
import { errorResponse, json, readJson } from "../../../h";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson<{ text?: unknown }>(request);
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return json({ error: "text is required" }, 400);
    }
    if (body.text.length > 4_000) return json({ error: "text must be 4000 characters or fewer" }, 400);
    return json(WorldHost.get().startRun(id, body.text), 202);
  } catch (error) {
    return errorResponse(error);
  }
}
