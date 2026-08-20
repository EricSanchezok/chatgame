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
    on_primary: "#101010",
    accent: "#e8a04c",
    text: "#e8dcc8",
    text_dim: "#9a8a72",
    border: "#4a3a28",
    focus: "#8ec9ba",
    success: "#70a875",
    warning: "#d8a24a",
    danger: "#d66a55",
    selected: "#3b3428",
  },
  typography: { font: "serif", scale: 1.0, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} },
  effects: { bubble_radius: 14, chrome_radius: 12, glass: 0.65, blur_px: 8, shadow: "medium", border_width_px: 1, density: "cozy", motion: "subtle", scene_tint: "#1c0f06", overlay_strength: 0.45 },
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
    expect(target.vars["--cg-line-height"]).toBe("1.6");
    expect(target.vars["--cg-letter-spacing"]).toBe("0em");
    expect(target.vars["--cg-radius"]).toBe("14px");
    expect(target.vars["--cg-radius-chrome"]).toBe("12px");
    expect(target.vars["--cg-glass"]).toBe("0.65");
    expect(target.vars["--cg-blur"]).toBe("8px");
    expect(target.vars["--cg-shadow"]).toBe("medium");
    expect(target.vars["--cg-shadow-value"]).toContain("rgba(0, 0, 0, 0.28)");
    expect(target.vars["--cg-border-width"]).toBe("1px");
    expect(target.vars["--cg-density"]).toBe("cozy");
    expect(target.vars["--cg-space-1"]).toBe("6px");
    expect(target.vars["--cg-space-4"]).toBe("24px");
    expect(target.vars["--cg-tint"]).toBe("#1c0f06");
    expect(target.vars["--cg-overlay-strength"]).toBe("0.45");
    expect(target.vars["--cg-motion"]).toBe("subtle");
    expect(target.vars["--cg-font"]).toContain("serif");
    expect(target.vars["--cg-font-narrative"]).toBe(target.vars["--cg-font"]);
    expect(target.vars["--cg-font-mono"]).toContain("mono");
  });

  it("is a no-op without a target (node safety)", () => {
    expect(() => applyTheme(theme, undefined)).not.toThrow();
  });
});

describe("applyTheme font faces", () => {
  it("resolves role families and injects @font-face rules", () => {
    const styleEls: Array<{ attrs: Record<string, string>; innerHTML: string; removed: boolean }> = [];
    const fakeDoc = {
      querySelector: (sel: string) => {
        if (sel === "style[data-cg-fonts]") {
          const existing = styleEls.find((s) => !s.removed);
          return existing ?? null;
        }
        return null;
      },
      createElement: () => {
        const el = {
          attrs: {} as Record<string, string>,
          innerHTML: "",
          removed: false,
          setAttribute: (n: string, v: string) => {
            el.attrs[n] = v;
          },
        };
        styleEls.push(el);
        return el;
      },
      head: { appendChild: () => undefined },
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
    try {
      const themed: ThemeView = {
        ...theme,
        typography: {
          font: "serif",
          scale: 1.0,
          line_height: 1.6,
          letter_spacing_em: 0,
          faces: [
            {
              id: "runes",
              family: "Rune Serif",
              files: [{ file: "assets/fonts/rune.woff2", weight: 700, style: "italic" }],
            },
          ],
          roles: { ui: "runes", narrative: "runes", mono: "mono" },
        },
      };
      const target = new FakeTarget();
      applyTheme(themed, target, {
        assetUrl: (f) => `/api/scripts/x/assets/${f.replace(/^assets\//, "")}`,
      });
      expect(target.vars["--cg-font"]).toContain("Rune Serif");
      expect(target.vars["--cg-font-narrative"]).toContain("Rune Serif");
      const style = styleEls.find((s) => !s.removed);
      expect(style?.innerHTML).toContain("@font-face");
      expect(style?.innerHTML).toContain('"Rune Serif"');
      expect(style?.innerHTML).toContain("assets/fonts/rune.woff2");
      expect(style?.innerHTML).toContain("font-weight:700");
    } finally {
      delete (globalThis as Record<string, unknown>).document;
    }
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
