import type {
  ActionPreview,
  CreateSessionResult,
  ImportCommitResult,
  ImportPreview,
  IntentHint,
  ScriptDetail,
  ScriptMeta,
  ScriptSummary,
  SessionPresentation,
  TurnInput,
  TurnResultFull,
  WorldStateView,
} from "../../shared/client-dto";

export type * from "../../shared/client-dto";
export type { WorldStateView as WorldState } from "../../shared/client-dto";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface GamePort {
  listScripts(signal?: AbortSignal): Promise<{ scripts: ScriptSummary[] }>;
  scriptDetail(scriptId: string, signal?: AbortSignal): Promise<ScriptDetail>;
  scriptMeta(scriptId: string, signal?: AbortSignal): Promise<ScriptMeta>;
  deleteScript(scriptId: string, signal?: AbortSignal): Promise<void>;
  previewImport(file: File, signal?: AbortSignal): Promise<ImportPreview>;
  commitImport(token: string, replace: boolean, signal?: AbortSignal): Promise<ImportCommitResult>;
  createSession(
    input: { scriptId: string; originId?: string; seed?: number; playerName?: string; loadRunId?: string },
    signal?: AbortSignal,
  ): Promise<CreateSessionResult>;
  submitTurn(id: string, input: TurnInput, signal?: AbortSignal): Promise<TurnResultFull>;
  previewAction(id: string, hint: IntentHint, signal?: AbortSignal): Promise<ActionPreview>;
  state(id: string, signal?: AbortSignal): Promise<{ id: string; state: WorldStateView; presentation: SessionPresentation }>;
  save(id: string, signal?: AbortSignal): Promise<{ saved: boolean; path: string }>;
  setDescriptor(id: string, path: string, text: string, signal?: AbortSignal): Promise<{ state: WorldStateView }>;
  advance(id: string, hours: number, signal?: AbortSignal): Promise<{ state: WorldStateView }>;
  destroySession(id: string, signal?: AbortSignal): Promise<void>;
  assetUrl(scriptId: string, file: string): string;
  entityAssetUrl(scriptId: string, kind: string, entityId: string): string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // A non-JSON error keeps the HTTP status text.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export class HttpGamePort implements GamePort {
  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = init.body instanceof FormData
      ? init.headers
      : init.body
        ? { "content-type": "application/json", ...init.headers }
        : init.headers;
    return fetch(path, { ...init, headers }).then(parseResponse<T>);
  }

  private post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body), signal });
  }

  listScripts(signal?: AbortSignal) {
    return this.request<{ scripts: ScriptSummary[] }>("/api/scripts", { signal });
  }

  scriptDetail(scriptId: string, signal?: AbortSignal) {
    return this.request<ScriptDetail>(`/api/scripts/${encodeURIComponent(scriptId)}`, { signal });
  }

  scriptMeta(scriptId: string, signal?: AbortSignal) {
    return this.request<ScriptMeta>(`/api/scripts/${encodeURIComponent(scriptId)}/meta`, { signal });
  }

  async deleteScript(scriptId: string, signal?: AbortSignal) {
    await this.request<{ deleted: true }>(`/api/scripts/${encodeURIComponent(scriptId)}`, { method: "DELETE", signal });
  }

  previewImport(file: File, signal?: AbortSignal) {
    const form = new FormData();
    form.set("file", file);
    return this.request<ImportPreview>("/api/scripts/import/preview", { method: "POST", body: form, signal });
  }

  commitImport(token: string, replace: boolean, signal?: AbortSignal) {
    return this.post<ImportCommitResult>("/api/scripts/import/commit", { token, replace }, signal);
  }

  createSession(input: Parameters<GamePort["createSession"]>[0], signal?: AbortSignal) {
    return this.post<CreateSessionResult>("/api/sessions", input, signal);
  }

  submitTurn(id: string, input: TurnInput, signal?: AbortSignal) {
    return this.post<TurnResultFull>(`/api/sessions/${encodeURIComponent(id)}/turn`, input, signal);
  }

  previewAction(id: string, hint: IntentHint, signal?: AbortSignal) {
    return this.post<ActionPreview>(`/api/sessions/${encodeURIComponent(id)}/action-preview`, hint, signal);
  }

  state(id: string, signal?: AbortSignal) {
    return this.request<{ id: string; state: WorldStateView; presentation: SessionPresentation }>(
      `/api/sessions/${encodeURIComponent(id)}/state`,
      { signal },
    );
  }

  save(id: string, signal?: AbortSignal) {
    return this.post<{ saved: boolean; path: string }>(`/api/sessions/${encodeURIComponent(id)}/save`, {}, signal);
  }

  setDescriptor(id: string, path: string, text: string, signal?: AbortSignal) {
    return this.post<{ state: WorldStateView }>(
      `/api/sessions/${encodeURIComponent(id)}/descriptor`,
      { path, text },
      signal,
    );
  }

  advance(id: string, hours: number, signal?: AbortSignal) {
    return this.post<{ state: WorldStateView }>(`/api/sessions/${encodeURIComponent(id)}/advance`, { hours }, signal);
  }

  async destroySession(id: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE", signal });
    if (!response.ok) await parseResponse<unknown>(response);
  }

  assetUrl(scriptId: string, file: string): string {
    return `/api/scripts/${encodeURIComponent(scriptId)}/assets/${file.replace(/^assets\//, "")}`;
  }

  entityAssetUrl(scriptId: string, kind: string, entityId: string): string {
    return `/api/scripts/${encodeURIComponent(scriptId)}/entity-assets/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}`;
  }
}

export const httpGamePort = new HttpGamePort();
