import type {
  WorldInspectorAttemptDetail,
  WorldInspectorRuntimeEventDetail,
  WorldInspectorStepDetail,
  WorldInspectorWindow,
} from "../../shared/world-inspector-api";
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
  runtimeEvent(instanceId: string, eventId: string) {
    return requestJson<WorldInspectorRuntimeEventDetail>(
      `${base(instanceId)}/runtime-events/${encodeURIComponent(eventId)}`,
    );
  },
  eventsUrl(instanceId: string) {
    return `${base(instanceId)}/events`;
  },
};
