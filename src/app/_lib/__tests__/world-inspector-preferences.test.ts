// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  WORLD_INSPECTOR_ACTOR_MAX,
  WORLD_INSPECTOR_ACTOR_MIN,
  WORLD_INSPECTOR_DETAIL_MAX,
  WORLD_INSPECTOR_DETAIL_MIN,
  WORLD_INSPECTOR_LAYOUT_KEY,
  parseWorldInspectorLayout,
  readWorldInspectorLayout,
  resizeWorldInspectorPanelWidth,
  writeWorldInspectorLayout,
} from "../world-inspector-preferences";

describe("world inspector layout preferences", () => {
  beforeEach(() => localStorage.clear());

  it("strictly parses, defaults and clamps stored layout values", () => {
    expect(parseWorldInspectorLayout("not-json")).toEqual({ actorWidth: 216, detailWidth: 480, view: "graph" });
    expect(parseWorldInspectorLayout(JSON.stringify({ actorWidth: 9, detailWidth: 9_999, view: "unknown" }))).toEqual({
      actorWidth: WORLD_INSPECTOR_ACTOR_MIN,
      detailWidth: WORLD_INSPECTOR_DETAIL_MAX,
      view: "graph",
    });
    expect(parseWorldInspectorLayout(JSON.stringify({ actorWidth: 9_999, detailWidth: 200, view: "timeline" }))).toEqual({
      actorWidth: WORLD_INSPECTOR_ACTOR_MAX,
      detailWidth: WORLD_INSPECTOR_DETAIL_MIN,
      view: "timeline",
    });
  });

  it("persists only the v2 layout contract", () => {
    writeWorldInspectorLayout({ actorWidth: 248.6, detailWidth: 512.4, view: "timeline" });
    expect(readWorldInspectorLayout()).toEqual({ actorWidth: 249, detailWidth: 512, view: "timeline" });
    expect(JSON.parse(localStorage.getItem(WORLD_INSPECTOR_LAYOUT_KEY)!)).toEqual({
      actorWidth: 249,
      detailWidth: 512,
      view: "timeline",
    });
  });

  it("supports both separators, accelerated steps, RTL and Home/End", () => {
    expect(resizeWorldInspectorPanelWidth(216, "ArrowRight", "actors")).toBe(232);
    expect(resizeWorldInspectorPanelWidth(216, "ArrowLeft", "actors", { shift: true })).toBe(176);
    expect(resizeWorldInspectorPanelWidth(216, "ArrowRight", "actors", { rtl: true })).toBe(200);
    expect(resizeWorldInspectorPanelWidth(480, "ArrowLeft", "detail")).toBe(496);
    expect(resizeWorldInspectorPanelWidth(480, "ArrowRight", "detail", { shift: true })).toBe(432);
    expect(resizeWorldInspectorPanelWidth(480, "ArrowLeft", "detail", { rtl: true })).toBe(464);
    expect(resizeWorldInspectorPanelWidth(216, "Home", "actors")).toBe(WORLD_INSPECTOR_ACTOR_MIN);
    expect(resizeWorldInspectorPanelWidth(216, "End", "actors")).toBe(WORLD_INSPECTOR_ACTOR_MAX);
    expect(resizeWorldInspectorPanelWidth(480, "Home", "detail")).toBe(WORLD_INSPECTOR_DETAIL_MIN);
    expect(resizeWorldInspectorPanelWidth(480, "End", "detail")).toBe(WORLD_INSPECTOR_DETAIL_MAX);
  });
});
