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
import type { WorldState } from "@/app/lib/api";

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

/**
 * Test-only adapter for the current HTTP UI boundary. Foundation can replace
 * the fetch bridge with the versioned GamePort without changing fixture data.
 */
export class MockGamePort {
  readonly scenario: Required<Pick<MockGameScenario, "library" | "conversation" | "session" | "turn">> &
    Omit<MockGameScenario, "library" | "conversation" | "session" | "turn">;
  private state: WorldState;

  constructor(scenario: MockGameScenario = {}) {
    this.scenario = {
      library: scenario.library ?? "ready",
      conversation: scenario.conversation ?? "short",
      session: scenario.session ?? "ready",
      turn: scenario.turn ?? "ready",
      detailErrorScriptId: scenario.detailErrorScriptId,
      latencyMs: scenario.latencyMs,
    };
    this.state = createFixtureWorld(CORE_SCRIPT_ID, this.scenario.conversation);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const delay = this.scenario.latencyMs?.[url.pathname] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    if (url.pathname === "/api/scripts" && method === "GET") {
      if (this.scenario.library === "error") return json({ error: "剧本库暂时不可用" }, 503);
      return json({ scripts: this.scenario.library === "empty" ? [] : fixtureScripts() });
    }

    if (url.pathname === "/api/scripts" && method === "POST") {
      return json({ scriptId: CORE_SCRIPT_ID, warnings: [] }, 201);
    }

    const metaMatch = url.pathname.match(/^\/api\/scripts\/([^/]+)\/meta$/);
    if (metaMatch && method === "GET") return json(fixtureMeta(decodeURIComponent(metaMatch[1])));

    const detailMatch = url.pathname.match(/^\/api\/scripts\/([^/]+)$/);
    if (detailMatch && method === "GET") {
      const scriptId = decodeURIComponent(detailMatch[1]);
      if (scriptId === this.scenario.detailErrorScriptId) return json({ error: "剧本详情载入失败" }, 503);
      if (scriptId !== CORE_SCRIPT_ID && scriptId !== ALT_SCRIPT_ID) return json({ error: "剧本不存在" }, 404);
      return json(fixtureDetail(scriptId));
    }

    if (url.pathname === "/api/sessions" && method === "POST") {
      if (this.scenario.session === "error") return json({ error: "会话恢复失败" }, 503);
      const body = (await requestBody(input, init)) as { scriptId?: string } | undefined;
      const scriptId = body?.scriptId ?? CORE_SCRIPT_ID;
      this.state = createFixtureWorld(scriptId, this.scenario.conversation);
      return json(
        {
          id: "preview-session",
          state: structuredClone(this.state),
          presentation: fixturePresentation(scriptId),
        },
        201,
      );
    }

    const turnMatch = url.pathname.match(/^\/api\/sessions\/[^/]+\/turn$/);
    if (turnMatch && method === "POST") {
      if (this.scenario.turn === "error") return json({ error: "世界响应超时" }, 503);
      const body = (await requestBody(input, init)) as { input?: string } | undefined;
      const result = fixtureTurnResult(this.state, body?.input ?? "");
      this.state = result.state;
      return json(result);
    }

    if (/^\/api\/sessions\/[^/]+\/save$/.test(url.pathname) && method === "POST") {
      return json({ saved: true, path: "/virtual/autosave.json" }, 201);
    }

    if (/^\/api\/sessions\/[^/]+\/advance$/.test(url.pathname) && method === "POST") {
      return json({ state: structuredClone(this.state) });
    }

    if (/^\/api\/sessions\/[^/]+\/descriptor$/.test(url.pathname) && method === "POST") {
      return json({ state: structuredClone(this.state) });
    }

    if (/^\/api\/sessions\/[^/]+$/.test(url.pathname) && method === "DELETE") {
      return json({ destroyed: true });
    }

    return json({ error: `MockGamePort 未实现 ${method} ${url.pathname}` }, 404);
  };

  install(): () => void {
    const previous = globalThis.fetch;
    globalThis.fetch = this.fetch;
    return () => {
      globalThis.fetch = previous;
    };
  }
}
