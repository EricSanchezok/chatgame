import type {
  ActionPreview,
  CreateSessionResult,
  GamePort,
  ImportCommitResult,
  ImportPreview,
  ScriptDetail,
  ScriptMeta,
  SessionPresentation,
  TurnInput,
  TurnResultFull,
  WorldState,
} from "@/app/lib/api";
import {
  ALT_SCRIPT_ID,
  CORE_SCRIPT_ID,
  createFixtureWorld,
  fixtureDetail,
  fixtureMeta,
  fixturePresentation,
  fixtureScripts,
  fixtureTurnResult,
  type ConversationFixture,
} from "./core-test-script";

export interface MockGameScenario {
  library?: "ready" | "empty" | "error";
  conversation?: ConversationFixture;
  session?: "ready" | "error";
  turn?: "ready" | "error";
  detailErrorScriptId?: string;
  latencyMs?: Partial<Record<string, number>>;
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requestUrl(input: RequestInfo | URL): URL {
  const raw = input instanceof Request ? input.url : String(input);
  const base = typeof location === "undefined" ? "http://workbench.local" : location.href;
  return new URL(raw, base);
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (typeof init?.body === "string") return JSON.parse(init.body) as unknown;
  if (input instanceof Request && input.body) {
    const text = await input.clone().text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }
  return undefined;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Deterministic implementation of the browser-safe GamePort contract. */
export class MockGamePort implements GamePort {
  readonly scenario: Required<Pick<MockGameScenario, "library" | "conversation" | "session" | "turn">> &
    Omit<MockGameScenario, "library" | "conversation" | "session" | "turn">;
  private currentWorld: WorldState;
  private currentPresentation: SessionPresentation;

  constructor(scenario: MockGameScenario = {}) {
    this.scenario = {
      library: scenario.library ?? "ready",
      conversation: scenario.conversation ?? "short",
      session: scenario.session ?? "ready",
      turn: scenario.turn ?? "ready",
      detailErrorScriptId: scenario.detailErrorScriptId,
      latencyMs: scenario.latencyMs,
    };
    this.currentWorld = createFixtureWorld(CORE_SCRIPT_ID, this.scenario.conversation);
    this.currentPresentation = fixturePresentation(CORE_SCRIPT_ID);
  }

  private async wait(path: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    const delay = this.scenario.latencyMs?.[path] ?? 0;
    if (delay <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(abortError());
        },
        { once: true },
      );
    });
  }

  async listScripts(signal?: AbortSignal): Promise<{ scripts: ReturnType<typeof fixtureScripts> }> {
    await this.wait("/api/scripts", signal);
    if (this.scenario.library === "error") throw new Error("剧本库暂时不可用");
    return { scripts: this.scenario.library === "empty" ? [] : fixtureScripts() };
  }

  async scriptDetail(scriptId: string, signal?: AbortSignal): Promise<ScriptDetail> {
    await this.wait(`/api/scripts/${scriptId}`, signal);
    if (scriptId === this.scenario.detailErrorScriptId) throw new Error("剧本详情载入失败");
    if (scriptId !== CORE_SCRIPT_ID && scriptId !== ALT_SCRIPT_ID) throw new Error("剧本不存在");
    return fixtureDetail(scriptId);
  }

  async scriptMeta(scriptId: string, signal?: AbortSignal): Promise<ScriptMeta> {
    await this.wait(`/api/scripts/${scriptId}/meta`, signal);
    return fixtureMeta(scriptId);
  }

  async deleteScript(scriptId: string, signal?: AbortSignal): Promise<void> {
    await this.wait(`/api/scripts/${scriptId}`, signal);
  }

  async previewImport(file: File, signal?: AbortSignal): Promise<ImportPreview> {
    await this.wait("/api/scripts/import-preview", signal);
    return {
      token: "workbench-import",
      scriptId: CORE_SCRIPT_ID,
      name: file.name,
      sourceName: file.name,
      schemaVersion: "1.1",
      apiVersions: { hostUi: 3, engine: 2, scriptUi: null },
      conflicts: { installed: false, replaceAllowed: false },
      permissions: [],
      assetProvenance: { manifestPresent: false, coveredFiles: 0, totalFiles: 0, missingFiles: [], extraFiles: [], remoteReferences: [] },
      risks: [],
      errors: [],
      warnings: [],
    };
  }

  async commitImport(_token: string, _replace: boolean, signal?: AbortSignal): Promise<ImportCommitResult> {
    await this.wait("/api/scripts/import-commit", signal);
    return { scriptId: CORE_SCRIPT_ID, warnings: [] };
  }

  async createSession(
    input: Parameters<GamePort["createSession"]>[0],
    signal?: AbortSignal,
  ): Promise<CreateSessionResult> {
    await this.wait("/api/sessions", signal);
    if (this.scenario.session === "error") throw new Error("会话恢复失败");
    this.currentWorld = createFixtureWorld(input.scriptId, this.scenario.conversation);
    this.currentPresentation = fixturePresentation(input.scriptId);
    return {
      id: "preview-session",
      state: structuredClone(this.currentWorld),
      presentation: structuredClone(this.currentPresentation),
    };
  }

  async submitTurn(id: string, input: TurnInput, signal?: AbortSignal): Promise<TurnResultFull> {
    await this.wait(`/api/sessions/${id}/turn`, signal);
    if (this.scenario.turn === "error") throw new Error("世界响应超时");
    const result = fixtureTurnResult(this.currentWorld, input.text);
    this.currentWorld = result.state;
    this.currentPresentation = result.presentation;
    return structuredClone(result);
  }

  async previewAction(
    id: string,
    hint: Parameters<GamePort["previewAction"]>[1],
    signal?: AbortSignal,
  ): Promise<ActionPreview> {
    await this.wait(`/api/sessions/${id}/action-preview`, signal);
    return {
      actionId: hint.actionId,
      displayName: hint.actionId,
      executable: true,
      timeCost: 0,
      costs: { currency: 0, items: [] },
      risk: { type: "none" },
    };
  }

  async state(id: string, signal?: AbortSignal) {
    await this.wait(`/api/sessions/${id}/state`, signal);
    return {
      id,
      state: structuredClone(this.currentWorld),
      presentation: structuredClone(this.currentPresentation),
    };
  }

  async save(id: string, signal?: AbortSignal) {
    await this.wait(`/api/sessions/${id}/save`, signal);
    return { saved: true, path: "/virtual/autosave.json" };
  }

  async setDescriptor(id: string, _path: string, _text: string, signal?: AbortSignal) {
    await this.wait(`/api/sessions/${id}/descriptor`, signal);
    return { state: structuredClone(this.currentWorld) };
  }

  async advance(id: string, _hours: number, signal?: AbortSignal) {
    await this.wait(`/api/sessions/${id}/advance`, signal);
    return { state: structuredClone(this.currentWorld) };
  }

  async destroySession(id: string, signal?: AbortSignal): Promise<void> {
    await this.wait(`/api/sessions/${id}`, signal);
  }

  assetUrl(scriptId: string, file: string): string {
    return `/api/scripts/${encodeURIComponent(scriptId)}/assets/${file.replace(/^assets\//, "")}`;
  }

  entityAssetUrl(scriptId: string, kind: string, entityId: string): string {
    return `/api/scripts/${encodeURIComponent(scriptId)}/entity-assets/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}`;
  }

  /**
   * Thin HTTP adapter retained only for Playwright route fulfillment. The
   * Storybook harness injects this object directly through GameProvider.
   */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    try {
      if (url.pathname === "/api/scripts" && method === "GET") {
        return json(await this.listScripts(init?.signal ?? undefined));
      }

      const metaMatch = url.pathname.match(/^\/api\/scripts\/([^/]+)\/meta$/);
      if (metaMatch && method === "GET") {
        return json(await this.scriptMeta(decodeURIComponent(metaMatch[1]), init?.signal ?? undefined));
      }

      const detailMatch = url.pathname.match(/^\/api\/scripts\/([^/]+)$/);
      if (detailMatch && method === "GET") {
        return json(await this.scriptDetail(decodeURIComponent(detailMatch[1]), init?.signal ?? undefined));
      }

      if (url.pathname === "/api/sessions" && method === "POST") {
        const body = (await requestBody(input, init)) as Parameters<GamePort["createSession"]>[0];
        return json(await this.createSession(body, init?.signal ?? undefined), 201);
      }

      const turnMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/turn$/);
      if (turnMatch && method === "POST") {
        const body = (await requestBody(input, init)) as TurnInput;
        return json(await this.submitTurn(decodeURIComponent(turnMatch[1]), body, init?.signal ?? undefined));
      }

      const saveMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/save$/);
      if (saveMatch && method === "POST") {
        return json(await this.save(decodeURIComponent(saveMatch[1]), init?.signal ?? undefined), 201);
      }

      const advanceMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/advance$/);
      if (advanceMatch && method === "POST") {
        const body = (await requestBody(input, init)) as { hours: number };
        return json(await this.advance(decodeURIComponent(advanceMatch[1]), body.hours, init?.signal ?? undefined));
      }

      const descriptorMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/descriptor$/);
      if (descriptorMatch && method === "POST") {
        const body = (await requestBody(input, init)) as { path: string; text: string };
        return json(
          await this.setDescriptor(
            decodeURIComponent(descriptorMatch[1]),
            body.path,
            body.text,
            init?.signal ?? undefined,
          ),
        );
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && method === "DELETE") {
        await this.destroySession(decodeURIComponent(sessionMatch[1]), init?.signal ?? undefined);
        return json({ destroyed: true });
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
    return json({ error: `MockGamePort 未实现 ${method} ${url.pathname}` }, 404);
  };
}
