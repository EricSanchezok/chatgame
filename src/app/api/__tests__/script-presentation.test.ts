import { describe, expect, it } from "vitest";
import type { EngineHost } from "../../../server/engine-host";
import type { SessionPresentation } from "../../../shared/client-dto";
import { completeSessionPresentation } from "../script-presentation";

describe("completeSessionPresentation", () => {
  it("preserves the authoritative defaultThemeId from the host", async () => {
    const theme = {
      id: "location-remap",
      name: "地点主题",
      palette: {},
      typography: {},
      effects: {},
    } as SessionPresentation["currentTheme"];
    const host = {
      scriptLibraryRoot: "/not-installed",
      sessionSnapshot: () => ({
        state: { scriptId: "missing-ui" },
        presentation: {
          themes: [theme],
          currentTheme: theme,
          defaultThemeId: "authoritative-theme",
          hasAssets: false,
        },
      }),
    } as unknown as EngineHost;

    const result = await completeSessionPresentation(host, "session");
    expect(result.defaultThemeId).toBe("authoritative-theme");
  });
});
