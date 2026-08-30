import type {
  WorldInspectorModelInvocationQuery,
  WorldInspectorModelInvocationStatus,
} from "../../../../../../shared/world-inspector-api";
import { WorldHost } from "../../../../../../server/world-host";
import { json, observedRoute } from "../../../../h";

const statuses = new Set<WorldInspectorModelInvocationStatus>(["active", "accepted", "rejected", "failed"]);
const sorts = new Set<NonNullable<WorldInspectorModelInvocationQuery["sort"]>>([
  "duration", "inputTokens", "outputTokens", "retries", "timestamp",
]);

function integer(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const sort = url.searchParams.get("sort") ?? undefined;
    if ((status && !statuses.has(status as WorldInspectorModelInvocationStatus)) ||
      (sort && !sorts.has(sort as NonNullable<WorldInspectorModelInvocationQuery["sort"]>))) {
      return json({ error: "invalid model invocation filter" }, 400);
    }
    const minDurationMs = integer(url.searchParams.get("minDurationMs"));
    const maxDurationMs = integer(url.searchParams.get("maxDurationMs"));
    const minInputTokens = integer(url.searchParams.get("minInputTokens"));
    const maxInputTokens = integer(url.searchParams.get("maxInputTokens"));
    const minRetries = integer(url.searchParams.get("minRetries"));
    const limit = integer(url.searchParams.get("limit"));
    if ([minDurationMs, maxDurationMs, minInputTokens, maxInputTokens, minRetries, limit].some(Number.isNaN) ||
      (limit !== undefined && (limit < 1 || limit > 100))) {
      return json({ error: "invalid model invocation range" }, 400);
    }
    return json(WorldHost.get().inspectorModelInvocations(id, {
      ...(url.searchParams.get("executionId") ? { executionId: url.searchParams.get("executionId")! } : {}),
      ...(url.searchParams.get("actorId") ? { actorId: url.searchParams.get("actorId")! } : {}),
      ...(url.searchParams.get("role") ? { role: url.searchParams.get("role")! } : {}),
      ...(url.searchParams.get("providerId") ? { providerId: url.searchParams.get("providerId")! } : {}),
      ...(url.searchParams.get("modelId") ? { modelId: url.searchParams.get("modelId")! } : {}),
      ...(status ? { status: status as WorldInspectorModelInvocationStatus } : {}),
      ...(minDurationMs !== undefined ? { minDurationMs } : {}),
      ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
      ...(minInputTokens !== undefined ? { minInputTokens } : {}),
      ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
      ...(minRetries !== undefined ? { minRetries } : {}),
      ...(sort ? { sort: sort as NonNullable<WorldInspectorModelInvocationQuery["sort"]> } : {}),
      ...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }));
  });
}
