// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("versioned player settings", () => {
  it("rejects an obsolete schema and restores complete v2 defaults", async () => {
    localStorage.setItem("chatgame:settings:v2", JSON.stringify({ version: 1, audioEnabled: true }));
    const settings = await import("../settings");
    expect(settings.hydratePlayerSettings()).toEqual(settings.defaultPlayerSettings);
  });

  it("persists theme, grouped volume and fullscreen preferences", async () => {
    const settings = await import("../settings");
    settings.patchPlayerSettings({
      themeMode: "default",
      audioEnabled: true,
      masterVolume: 73,
      ambientVolume: 42,
      voiceVolume: 91,
      effectsVolume: 58,
      fullscreenOnStart: false,
    });
    expect(JSON.parse(localStorage.getItem(settings.SETTINGS_STORAGE_KEY)!)).toMatchObject({
      version: 2,
      themeMode: "default",
      masterVolume: 73,
      ambientVolume: 42,
      voiceVolume: 91,
      effectsVolume: 58,
      fullscreenOnStart: false,
    });
  });
});
