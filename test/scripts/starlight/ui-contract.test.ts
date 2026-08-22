import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import registerStarlightUi, { apiVersion } from "../../../scripts/starlight/ui/index";
import type { ScriptUiContext, SlotId } from "../../../src/shared/ui-api";

const SCRIPT_DIR = path.resolve(__dirname, "../../../scripts/starlight");

function assetFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const absolute = path.join(dir, name);
    return statSync(absolute).isDirectory() ? assetFiles(absolute) : [absolute];
  });
}

describe("Starlight conversation-first UI contract", () => {
  it("inherits the host conversation shell and registers only script-specific surfaces", () => {
    const slots = new Map<SlotId, unknown>();
    let configured = false;
    const context: ScriptUiContext = {
      apiVersion: 6,
      register(slot, definition) {
        slots.set(slot, definition.component);
      },
      configureGame() { configured = true; },
    };
    registerStarlightUi(context);
    expect(apiVersion).toBe(6);
    expect(configured).toBe(true);
    expect([...slots.keys()].sort()).toEqual([
      "panel:inventory",
      "panel:map",
      "panel:records",
      "panel:tasks",
    ]);
    expect(slots.has("game-shell")).toBe(false);
    expect(slots.has("scene")).toBe(false);
  });

  it("reads host props and delegates actions without fetch or a private game store", () => {
    const source = readFileSync(path.join(SCRIPT_DIR, "ui/index.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|createContext|useReducer)\b/);
    expect(source).toContain("runtimeState");
    expect(source).toContain("starlightSuggestions");
    expect(source).toContain("ctx.configureGame");
    expect(source).not.toContain("previewAction");
    expect(source).not.toContain("submitTurn");
    expect(source).not.toContain("cg-composer");
    expect(source).not.toContain('ctx.register("game-shell"');
    expect(source).not.toContain('ctx.register("scene"');
    expect(source).not.toContain("StarlightGameShell");
    expect(source).not.toContain("StarlightScene");
    expect(source).not.toContain("sl-workspace");
  });

  it("covers compact phone, tablet, desktop, short landscape, 200% text, reduced motion and contrast", () => {
    const css = readFileSync(path.join(SCRIPT_DIR, "ui/styles.ts"), "utf8");
    const source = readFileSync(path.join(SCRIPT_DIR, "ui/index.tsx"), "utf8");
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-contrast: more)");
    expect(css).toContain("var(--cg-scale)");
    expect(css).not.toContain(".sl-button");
    expect(source).not.toContain("ActionChoice");
    expect(source).not.toContain("InputGroup");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|hsl|oklch)a?\(/i);
  });

  it("uses only local raster scene art and records provenance for every shipped asset", () => {
    const manifest = YAML.parse(readFileSync(path.join(SCRIPT_DIR, "assets.yaml"), "utf8")) as {
      cover: { file: string };
      backgrounds: Record<string, { file: string }>;
    };
    const referencedArt = [manifest.cover.file, ...Object.values(manifest.backgrounds).map((entry) => entry.file)];
    expect(referencedArt).toHaveLength(5);
    expect(referencedArt.every((file) => file.endsWith(".webp"))).toBe(true);
    expect(referencedArt.every((file) => !file.endsWith(".svg"))).toBe(true);

    const provenance = YAML.parse(readFileSync(path.join(SCRIPT_DIR, "assets/provenance.yaml"), "utf8")) as {
      files: Record<string, { source: string; license: string }>;
    };
    const shipped = assetFiles(path.join(SCRIPT_DIR, "assets"))
      .map((file) => path.relative(SCRIPT_DIR, file))
      .filter((file) => file !== "assets/provenance.yaml")
      .sort();
    expect(Object.keys(provenance.files).sort()).toEqual(shipped);
    for (const entry of Object.values(provenance.files)) {
      expect(entry.source.length).toBeGreaterThan(8);
      expect(entry.license.length).toBeGreaterThan(2);
    }
  });
});
