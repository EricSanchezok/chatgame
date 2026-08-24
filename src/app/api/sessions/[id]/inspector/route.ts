import { WorldHost, WorldHostError } from "../../../../../server/world-host";
import { json, observedRoute } from "../../../h";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

function parseInteger(value: string | null, name: string, fallback?: number): number | undefined {
  if (value === null && fallback !== undefined) return fallback;
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    throw new WorldHostError(`${name} must be a positive safe integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new WorldHostError(`${name} must be a positive safe integer`, 400);
  return parsed;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = parseInteger(url.searchParams.get("limit"), "limit", 24)!;
    if (limit > 50) throw new WorldHostError("limit must not exceed 50", 400);
    const beforeRevisionRaw = url.searchParams.get("beforeRevision");
    const beforeRevision = beforeRevisionRaw === null
      ? undefined
      : parseInteger(beforeRevisionRaw, "beforeRevision");
    return json(WorldHost.get().inspectorWindow(
      id,
      { limit, ...(beforeRevision !== undefined ? { beforeRevision } : {}) },
      { ...scope.correlation, sessionId: id },
    ));
  });
}
