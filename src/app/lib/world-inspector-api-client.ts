import type {
  WorldInspectorAttemptDetail,
  WorldInspectorModelInvocationDetail,
  WorldInspectorModelInvocationQuery,
  WorldInspectorModelInvocationQueryResult,
  WorldInspectorRuntimeEventDetail,
  WorldInspectorReplay,
  WorldInspectorStepDetail,
  WorldInspectorWindow,
} from "../../shared/world-inspector-api";
import type { DebugInspection } from "../../shared/debug-api";
import { requestJson } from "./api-client";

function base(instanceId: string): string {
  return `/api/instances/${encodeURIComponent(instanceId)}/inspector`;
}

export const worldInspectorApi = {
  window(instanceId: string, input: { beforeRevision?: number; limit?: number } = {}) {
    const search = new URLSearchParams();
    if (input.beforeRevision !== undefined) search.set("beforeRevision", String(input.beforeRevision));
    if (input.limit !== undefined) search.set("limit", String(input.limit));
    const query = search.size > 0 ? `?${search}` : "";
    return requestJson<WorldInspectorWindow>(`${base(instanceId)}${query}`);
  },
  step(instanceId: string, revision: number) {
    return requestJson<WorldInspectorStepDetail>(`${base(instanceId)}/steps/${revision}`);
  },
  attempt(instanceId: string, attemptId: string) {
    return requestJson<WorldInspectorAttemptDetail>(
      `${base(instanceId)}/attempts/${encodeURIComponent(attemptId)}`,
    );
  },
  modelInvocations(instanceId: string, input: WorldInspectorModelInvocationQuery = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const query = search.size > 0 ? `?${search}` : "";
    return requestJson<WorldInspectorModelInvocationQueryResult>(
      `${base(instanceId)}/model-invocations${query}`,
    );
  },
  modelInvocation(instanceId: string, executionId: string, invocationId: string) {
    return requestJson<WorldInspectorModelInvocationDetail>(
      `${base(instanceId)}/attempts/${encodeURIComponent(executionId)}/model-invocations/${encodeURIComponent(invocationId)}`,
    );
  },
  runtimeEvent(instanceId: string, eventId: string) {
    return requestJson<WorldInspectorRuntimeEventDetail>(
      `${base(instanceId)}/runtime-events/${encodeURIComponent(eventId)}`,
    );
  },
  replay(instanceId: string, executionId: string) {
    return requestJson<WorldInspectorReplay>(
      `${base(instanceId)}/replay/${encodeURIComponent(executionId)}`,
    );
  },
  eventsUrl(instanceId: string) {
    return `${base(instanceId)}/events`;
  },
  debugInspect(invocationId: string, includePayload = false) {
    const query = includePayload ? "?payload=true" : "";
    return requestJson<DebugInspection>(
      `/api/debug/invocations/${encodeURIComponent(invocationId)}${query}`,
    );
  },
};
