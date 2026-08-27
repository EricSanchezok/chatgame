import { WorldHost } from "../../../../../server/world-host";
import { json, observedRoute } from "../../../h";

function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export async function GET(request: Request, { params }: RouteContext<"/api/instances/[id]/inspector">): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    const url = new URL(request.url);
    const limit = integer(url.searchParams.get("limit"), 20);
    const beforeRevision = url.searchParams.has("beforeRevision")
      ? integer(url.searchParams.get("beforeRevision"), 0)
      : undefined;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1))) {
      return json({ error: "invalid inspector window" }, 400);
    }
    return json(WorldHost.get().inspectorWindow(id, { limit, ...(beforeRevision ? { beforeRevision } : {}) }));
  });
}
