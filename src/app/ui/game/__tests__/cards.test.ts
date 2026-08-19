// Card degradation tests: assetSrc resolution order (file -> prompt ->
// empty), grade labels, and cue summaries. Pure functions, node-safe.
import { describe, expect, it } from "vitest";
import { assetSrc, gradeLabel, cueSummary } from "../cards";
import type { AssetManifest, MediaCue } from "../../../lib/api";

const manifest: AssetManifest = {
  portraits: {
    elara: { file: "assets/portraits/elara.svg", alt: "艾拉" },
    guardian: { prompt: "mine golem" },
  },
  backgrounds: { tavern: { prompt: "steampunk tavern" } },
  icons: { pickaxe: { file: "assets/icons/pickaxe.svg" } },
  sprites: {},
  voices: { elara: { prompt: "calm", profile: "低哑" } },
  ambient: {},
  effects: {},
};

describe("assetSrc", () => {
  it("prefers the declared file", () => {
    expect(assetSrc("emberfall", manifest, "portraits", "elara")).toBe(
      "/api/scripts/emberfall/assets/portraits/elara.svg",
    );
  });

  it("falls back to the prompt-generated entity URL", () => {
    expect(assetSrc("emberfall", manifest, "portraits", "guardian")).toBe(
      "/api/scripts/emberfall/entity-assets/portraits/guardian",
    );
    expect(assetSrc("emberfall", manifest, "backgrounds", "tavern")).toBe(
      "/api/scripts/emberfall/entity-assets/backgrounds/tavern",
    );
  });

  it("returns empty for unknown entities (graceful degradation)", () => {
    expect(assetSrc("emberfall", manifest, "portraits", "nobody")).toBe("");
    expect(assetSrc("emberfall", undefined, "portraits", "elara")).toBe("");
    expect(assetSrc("emberfall", manifest, "ambient", "tavern")).toBe("");
  });
});

describe("gradeLabel", () => {
  it("maps engine grades to Chinese labels", () => {
    expect(gradeLabel("crit")).toBe("大成功");
    expect(gradeLabel("success")).toBe("成功");
    expect(gradeLabel("partial")).toBe("部分成功");
    expect(gradeLabel("fail")).toBe("失败");
    expect(gradeLabel("??")).toBe("??");
  });
});

describe("cueSummary", () => {
  it("summarizes each cue kind", () => {
    const cues: MediaCue[] = [
      { kind: "npc_speech", npcId: "elara" },
      { kind: "location_enter", locationId: "mine" },
      { kind: "event", eventId: "collapse" },
    ];
    expect(cueSummary(cues[0])).toBe("npc_speech:elara");
    expect(cueSummary(cues[1])).toBe("location_enter:mine");
    expect(cueSummary(cues[2])).toBe("event:collapse");
  });
});
