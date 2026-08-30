// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldInspectorRuntimeEventSummary } from "../../shared/world-inspector-api";
import { JsonInspector, RuntimeEventPayload } from "./world-inspector-json";

const runtimeEvent = vi.hoisted(() => vi.fn());

vi.mock("../lib/world-inspector-api-client", () => ({
  worldInspectorApi: { runtimeEvent },
}));

const event: WorldInspectorRuntimeEventSummary = {
  schemaVersion: 2,
  sequence: 7,
  timestamp: "2026-08-25T01:00:00.000Z",
  level: "info",
  event: "model.structured_output.parsed",
  id: `runtime-${"a".repeat(64)}`,
  hasPayload: true,
};

describe("console JSON inspector", () => {
  beforeEach(() => {
    runtimeEvent.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  afterEach(cleanup);

  it("opens error paths by default and mounts array entries in batches", () => {
    const values = Array.from({ length: 105 }, (_, index) => ({ index }));
    const { container } = render(<JsonInspector label="诊断 JSON" value={{ error: { message: "boom" }, values }} />);
    expect(screen.getByText('"boom"')).toBeVisible();
    const valuesSummary = [...container.querySelectorAll("summary")].find((node) => node.textContent?.includes("values"));
    expect(valuesSummary).toBeDefined();
    const valuesDetails = valuesSummary!.closest("details")!;
    valuesDetails.open = true;
    fireEvent(valuesDetails, new Event("toggle"));
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再显示 5 项" }));
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("copies the current object and announces the result", async () => {
    render(<JsonInspector label="对象" value={{ answer: 42 }} />);
    fireEvent.click(screen.getByRole("button", { name: "复制对象" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "answer": 42\n}'));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已复制完整对象"));
  });

  it("switches between compact tree and complete raw text modes", () => {
    const value = { longKey: "一段需要完整保留的中文证据", nested: { count: 2 } };
    const { container } = render(<JsonInspector label="对象" value={value} />);

    expect(container.querySelector(".cg-json-inspector__tree")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "原始文本" }));
    expect(container.querySelector(".cg-json-inspector__tree")).not.toBeInTheDocument();
    expect(container.querySelector(".cg-json-inspector__raw")?.textContent).toBe(JSON.stringify(value, null, 2));
    fireEvent.click(screen.getByRole("button", { name: "树视图" }));
    expect(container.querySelector(".cg-json-inspector__tree")).toBeInTheDocument();
  });

  it("uses one labelled copy menu per field without duplicating root actions", async () => {
    const { container } = render(<JsonInspector label="对象" value={{ correlation: { requestId: "request-1" } }} />);
    expect(container.querySelector('.cg-json-branch[data-depth="0"] > .cg-json-copy-menu')).toBeNull();
    const correlationCopy = screen.getByLabelText("复制 correlation");
    const correlationMenu = correlationCopy.closest("details")!;
    correlationMenu.open = true;
    fireEvent.click(screen.getByRole("button", { name: "复制路径" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("$.correlation"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已复制字段路径"));
    correlationMenu.open = true;
    fireEvent.click(screen.getByRole("button", { name: "复制值" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "requestId": "request-1"\n}'));
  });

  it("loads payload only after disclosure opens and supports an inline retry", async () => {
    runtimeEvent
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce({ apiVersion: 2, event: { ...event, payload: { accepted: true } } });
    const { container } = render(<RuntimeEventPayload event={event} instanceId="instance-1" />);
    expect(runtimeEvent).not.toHaveBeenCalled();
    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByRole("alert")).toHaveTextContent("expired");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("accepted")).toBeVisible();
    expect(runtimeEvent).toHaveBeenCalledTimes(2);
  });
});
