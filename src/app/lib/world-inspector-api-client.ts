import type {
  WorldInspectorAttemptDetail,
  WorldInspectorStepDetail,
  WorldInspectorWindow,
} from "../../shared/world-inspector-api";
import { requestJson } from "./api-client";

function base(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/inspector`;
}

export const worldInspectorApi = {
  window(sessionId: string, input: { beforeRevision?: number; limit?: number } = {}) {
    const search = new URLSearchParams();
    if (input.beforeRevision !== undefined) search.set("beforeRevision", String(input.beforeRevision));
    if (input.limit !== undefined) search.set("limit", String(input.limit));
    const query = search.size > 0 ? `?${search}` : "";
    return requestJson<WorldInspectorWindow>(`${base(sessionId)}${query}`);
  },
  step(sessionId: string, revision: number) {
    return requestJson<WorldInspectorStepDetail>(`${base(sessionId)}/steps/${revision}`);
  },
  attempt(sessionId: string, attemptId: string) {
    return requestJson<WorldInspectorAttemptDetail>(
      `${base(sessionId)}/attempts/${encodeURIComponent(attemptId)}`,
    );
  },
  eventsUrl(sessionId: string) {
    return `${base(sessionId)}/events`;
  },
};
