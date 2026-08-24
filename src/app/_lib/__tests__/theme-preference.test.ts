import { describe, expect, it } from "vitest";
import { normalizeThemePreference, themePreferences } from "../theme-preference";

describe("theme preference", () => {
  it("accepts only the three product theme modes", () => {
    expect(themePreferences).toEqual(["system", "light", "dark"]);
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("system")).toBe("system");
  });

  it("falls back to the system theme for missing or stale values", () => {
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference("sepia")).toBe("system");
  });
});
