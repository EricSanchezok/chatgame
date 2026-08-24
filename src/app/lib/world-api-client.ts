import type {
  PublicSessionDetail,
  PublicSessionSummary,
  StartWorldRunResponse,
  WorldRunSnapshot,
  WorldSummary,
} from "../../shared/world-api";
import { requestJson } from "./api-client";

export { WorldApiError } from "./api-client";

function post<T>(url: string, body?: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const worldApi = {
  worlds: () => requestJson<{ worlds: WorldSummary[] }>("/api/worlds"),
  sessions: () => requestJson<{ sessions: PublicSessionSummary[] }>("/api/sessions"),
  createSession: (worldId: string, seed?: number) =>
    post<PublicSessionDetail>("/api/sessions", { worldId, seed }),
  session: (sessionId: string) =>
    requestJson<PublicSessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`),
  renameSession: (sessionId: string, title: string) =>
    requestJson<PublicSessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  deleteSession: (sessionId: string) =>
    requestJson<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  startRun: (sessionId: string, text: string) =>
    post<StartWorldRunResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/runs`, { text }),
  continueRun: (sessionId: string, runId: string, id: string, text: string) =>
    post<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/inputs`,
      { id, text },
    ),
  run: (sessionId: string, runId: string) =>
    requestJson<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
    ),
  retryRun: (sessionId: string, runId: string) =>
    post<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
    ),
  cancelRun: (sessionId: string, runId: string) =>
    requestJson<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    ),
  runEventsUrl: (sessionId: string, runId: string, afterSequence = 0) => {
    const base = `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/events`;
    return afterSequence > 0 ? `${base}?after=${afterSequence}` : base;
  },
  importWorld: (file: File, options: { replace?: boolean; expectedWorldId?: string } = {}) => {
    const form = new FormData();
    form.set("file", file);
    form.set("replace", String(options.replace === true));
    if (options.expectedWorldId) form.set("expectedWorldId", options.expectedWorldId);
    return requestJson<{ id: string; name: string; description: string; replaced: boolean }>(
      "/api/worlds/import",
      { method: "POST", body: form },
    );
  },
  deleteWorld: (worldId: string) =>
    requestJson<void>(`/api/worlds/${encodeURIComponent(worldId)}`, { method: "DELETE" }),
};
