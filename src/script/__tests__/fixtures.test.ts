// Fixture integration tests: every script directory under scripts/ must
// pass the full validator (structural zod + semantic reference checks).
// This proves both fixtures (emberfall, starlight) are valid scripts.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateScriptDir } from "../validate";

const scriptsRoot = path.resolve(__dirname, "../../../scripts");

function findScriptDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => {
      const abs = path.join(root, entry);
      return (
        existsSync(path.join(abs, "script.yaml")) &&
        readdirSync(abs).includes("script.yaml")
      );
    })
    .map((entry) => path.join(root, entry));
}

describe("script fixtures", () => {
  const dirs = findScriptDirs(scriptsRoot);

  it("discovers at least one fixture", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  for (const dir of dirs) {
    const name = path.basename(dir);
    it(`${name}: passes full validation`, () => {
      const result = validateScriptDir(dir);
      const detail = result.issues
        .slice(0, 10)
        .map((i) => `${i.file}${i.line !== undefined ? `:${i.line}` : ""} [${i.path}] ${i.message}`)
        .join("\n");
      expect(result.ok, `validation issues:\n${detail}`).toBe(true);
    });
  }
});
