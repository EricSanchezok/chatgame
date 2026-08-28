// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRegistryDiagnostics } from "../../engine/models/model-provider";
import { ModelRegistrySettings } from "./model-registry-settings";

const diagnostics: ModelRegistryDiagnostics = {
  catalog: { schemaVersion: 3, hash: "a".repeat(64) },
  registry: {
    source: "https://models.dev/api.json",
    health: "degraded",
    refreshing: false,
    currentHash: "b".repeat(64),
    checkedAt: "2026-08-28T08:00:00.000Z",
    ageMs: 1_000,
    stale: false,
    lastError: "offline",
  },
  accounts: [{
    id: "deepseek-api",
    channel: "api",
    region: "global",
    protocol: "openai-chat",
    credentialConfigured: true,
  }, {
    id: "kimi-coding-plan",
    channel: "coding-plan",
    region: "cn",
    protocol: "anthropic-messages",
    credentialConfigured: false,
  }],
  profiles: [{
    id: "agent-deepseek",
    accountId: "deepseek-api",
    credentialConfigured: true,
    resolvedModelId: "deepseek-v4-pro",
    modelMetadataHash: "c".repeat(64),
    structuredOutputMode: "json-object-zod",
    resolutionError: null,
  }],
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("model registry settings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(diagnostics)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("announces health, credentials, and profile resolution without color-only status", async () => {
    render(<ModelRegistrySettings />);
    const region = screen.getByRole("region", { name: "模型供应商" });
    expect(region).toHaveAttribute("aria-busy", "true");
    const liveStatus = screen.getByRole("status");

    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByText("刷新失败，正在使用上次可用目录", { selector: "dd" })).toBeVisible();
    expect(screen.getByText("凭证已配置")).toBeVisible();
    expect(screen.getByText("凭证未配置")).toBeVisible();
    expect(liveStatus).toBe(screen.getByRole("status"));
    expect(liveStatus).toHaveTextContent("刷新失败，正在使用上次可用目录");
  });

  it("uses one native busy button and keeps the live region stable across refresh", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(diagnostics))
      .mockResolvedValueOnce(response({
        outcome: "unchanged",
        checkedAt: "2026-08-28T08:01:00.000Z",
        error: null,
        diagnostics: { ...diagnostics, registry: { ...diagnostics.registry, health: "fresh" } },
      }));
    render(<ModelRegistrySettings />);
    const button = await screen.findByRole("button", { name: "刷新模型目录" });
    await waitFor(() => expect(button).toBeEnabled());
    const liveStatus = screen.getByRole("status");

    fireEvent.click(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByRole("status")).toBe(liveStatus);
    expect(liveStatus).toHaveTextContent("模型目录已检查，没有发现变化");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/model-registry/refresh", { method: "POST" });
  });
});
