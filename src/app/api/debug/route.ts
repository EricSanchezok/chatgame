import { WorldHost, WorldHostError } from "../../../server/world-host";
import type { DebugComponent, DebugQuery } from "../../../shared/debug-api";
import { json, observedRoute } from "../h";

const components = new Set<DebugComponent>([
  "http", "world-host", "scheduler", "simulation", "algorithm", "model", "persistence", "inspector", "cli", "ui",
]);

function queryFromUrl(url: URL): DebugQuery {
  const integer = (name: string): number | undefined => {
    const value = url.searchParams.get(name);
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
  };
  const component = url.searchParams.get("component") ?? undefined;
  if (component && !components.has(component as DebugComponent)) throw new WorldHostError("invalid debug component", 400);
  const eventSequence = integer("event");
  const limit = integer("limit");
  if (Number.isNaN(eventSequence) || Number.isNaN(limit) || (limit !== undefined && (limit < 1 || limit > 100))) {
    throw new WorldHostError("invalid debug query range", 400);
  }
  return {
    ...(url.searchParams.get("invocation") ? { invocationId: url.searchParams.get("invocation")! } : {}),
    ...(url.searchParams.get("sourceInvocation") ? { sourceInvocationId: url.searchParams.get("sourceInvocation")! } : {}),
    ...(url.searchParams.get("execution") ? { executionId: url.searchParams.get("execution")! } : {}),
    ...(url.searchParams.get("instance") ? { instanceId: url.searchParams.get("instance")! } : {}),
    ...(url.searchParams.get("request") ? { requestId: url.searchParams.get("request")! } : {}),
    ...(url.searchParams.get("trace") ? { traceId: url.searchParams.get("trace")! } : {}),
    ...(url.searchParams.get("span") ? { spanId: url.searchParams.get("span")! } : {}),
    ...(eventSequence !== undefined ? { eventSequence } : {}),
    ...(url.searchParams.get("artifact") ? { artifactHash: url.searchParams.get("artifact")! } : {}),
    ...(url.searchParams.get("issue") ? { diagnosticCode: url.searchParams.get("issue")! } : {}),
    ...(component ? { component: component as DebugComponent } : {}),
    ...(url.searchParams.get("operation") ? { operation: url.searchParams.get("operation")! } : {}),
    ...(url.searchParams.get("eventName") ? { eventName: url.searchParams.get("eventName")! } : {}),
    ...(url.searchParams.get("from") ? { from: url.searchParams.get("from")! } : {}),
    ...(url.searchParams.get("to") ? { to: url.searchParams.get("to")! } : {}),
    ...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(url.searchParams.get("payload") === "true" ? { includePayload: true } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  return observedRoute(request, async () => json(WorldHost.get().debugQuery(queryFromUrl(new URL(request.url)))));
}
