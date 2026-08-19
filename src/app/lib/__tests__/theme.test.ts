// Theme application tests: CSS variable mapping, rgba conversion, and the
// no-DOM fallback (a fake target stands in for document.documentElement).
import { describe, expect, it } from "vitest";
import { applyTheme, rgba, type ThemeView, type CssTarget } from "../theme";

const theme: ThemeView = {
  id: "default",
  name: "灰烬镇",
  palette: {
    background: "#1a1410",
    surface: "#241c15",
    surface_alt: "#2e2218",
    primary: "#c96f2f",
    accent: "#e8a04c",
    text: "#e8dcc8",
    text_dim: "#9a8a72",
    border: "#4a3a28",
  },
  typography: { font: "serif", scale: 1.0 },
  effects: { bubble_radius: 14, glass: 0.65, motion: "subtle", scene_tint: "#1c0f06" },
};

/** Records setProperty calls into a plain object for assertions. */
class FakeTarget implements CssTarget {
  readonly vars: Record<string, string> = {};
  readonly style = {
    setProperty: (name: string, value: string) => {
      this.vars[name] = value;
    },
  };
}

describe("applyTheme", () => {
  it("maps every palette/typography/effect field onto --cg-* variables", () => {
    const target = new FakeTarget();
    applyTheme(theme, target);
    expect(target.vars["--cg-background"]).toBe("#1a1410");
    expect(target.vars["--cg-surface"]).toBe("#241c15");
    expect(target.vars["--cg-surface-alt"]).toBe("#2e2218");
    expect(target.vars["--cg-primary"]).toBe("#c96f2f");
    expect(target.vars["--cg-accent"]).toBe("#e8a04c");
    expect(target.vars["--cg-text"]).toBe("#e8dcc8");
    expect(target.vars["--cg-text-dim"]).toBe("#9a8a72");
    expect(target.vars["--cg-border"]).toBe("#4a3a28");
    expect(target.vars["--cg-scale"]).toBe("1");
    expect(target.vars["--cg-radius"]).toBe("14px");
    expect(target.vars["--cg-glass"]).toBe("0.65");
    expect(target.vars["--cg-tint"]).toBe("#1c0f06");
    expect(target.vars["--cg-motion"]).toBe("subtle");
    expect(target.vars["--cg-font"]).toContain("serif");
  });

  it("is a no-op without a target (node safety)", () => {
    expect(() => applyTheme(theme, undefined)).not.toThrow();
  });
});

describe("rgba", () => {
  it("converts 6-digit hex", () => {
    expect(rgba("#1a1410", 0.5)).toBe("rgba(26, 20, 16, 0.5)");
  });

  it("converts 3-digit hex", () => {
    expect(rgba("#abc", 1)).toBe("rgba(170, 187, 204, 1)");
  });
});
