import type {
  PublicSessionSnapshot,
  StartWorldRunResponse,
  WorldRunSnapshot,
  WorldSummary,
} from "../../shared/world-api";

export class WorldApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "WorldApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new WorldApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const worldApi = {
  worlds: () => request<{ worlds: WorldSummary[] }>("/api/worlds"),
  sessions: () => request<{ sessions: PublicSessionSnapshot[] }>("/api/sessions"),
  createSession: (worldId: string, seed?: number) =>
    post<PublicSessionSnapshot>("/api/sessions", { worldId, seed }),
  session: (sessionId: string) =>
    request<PublicSessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}`),
  startRun: (sessionId: string, text: string) =>
    post<StartWorldRunResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/runs`, { text }),
  continueRun: (sessionId: string, runId: string, id: string, text: string) =>
    post<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/inputs`,
      { id, text },
    ),
  run: (sessionId: string, runId: string) =>
    request<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
    ),
  retryRun: (sessionId: string, runId: string) =>
    post<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
    ),
  cancelRun: (sessionId: string, runId: string) =>
    request<WorldRunSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    ),
  runEventsUrl: (sessionId: string, runId: string, afterSequence = 0) => {
    const base = `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/events`;
    return afterSequence > 0 ? `${base}?after=${afterSequence}` : base;
  },
  importWorld: (file: File, replace = false) => {
    const form = new FormData();
    form.set("file", file);
    form.set("replace", String(replace));
    return request<{ id: string; name: string; description: string; replaced: boolean }>(
      "/api/worlds/import",
      { method: "POST", body: form },
    );
  },
};
