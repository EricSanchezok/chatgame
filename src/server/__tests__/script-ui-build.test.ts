// Script UI build pipeline tests: ESM bundling with react shim rewriting,
// error surfacing (file/line info), and content-hash cache invalidation.
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScriptUi, rewriteReactImports, uiBundlePath } from "../script-ui-build";

let scriptsRoot: string;
const buildRoot = path.join(".chatgame", "build");

beforeEach(() => {
  scriptsRoot = path.join(tmpdir(), `cg-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scriptsRoot, { recursive: true });
});

afterEach(() => {
  rmSync(scriptsRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
});

/** Writes a script dir with ui/index.tsx and returns its path. */
function writeUi(scriptId: string, code: string): string {
  const scriptDir = path.join(scriptsRoot, scriptId);
  mkdirSync(path.join(scriptDir, "ui"), { recursive: true });
  writeFileSync(path.join(scriptDir, "ui", "index.tsx"), code);
  return scriptDir;
}

const SIMPLE_UI = [
  'import { useState } from "react";',
  "export default function register(ctx: any) {",
  '  ctx.register("hud", {',
  "    component: function Hud() {",
  "      const [count] = useState(0);",
  "      return <div>{count}</div>;",
  "    },",
  "  });",
  "}",
].join("\n");

describe("rewriteReactImports", () => {
  it("rewrites double- and single-quoted react imports to runtime shims", () => {
    const code = [
      'import x from "react";',
      "import y from 'react';",
      'import { z } from "react/jsx-runtime";',
      "import { w } from 'react/jsx-runtime';",
    ].join("\n");
    const out = rewriteReactImports(code);
    expect(out).toContain('from "/api/runtime/react.mjs"');
    expect(out).toContain("from '/api/runtime/react.mjs'");
    expect(out).toContain('from "/api/runtime/jsx-runtime.mjs"');
    expect(out).toContain("from '/api/runtime/jsx-runtime.mjs'");
    expect(out).not.toMatch(/from\s*["']react["']/);
    expect(out).not.toMatch(/from\s*["']react\/jsx-runtime["']/);
  });
});

describe("buildScriptUi", () => {
  it("bundles a ui extension into browser ESM with shimmed react imports", async () => {
    const scriptDir = writeUi("test-bundle", SIMPLE_UI);
    const result = await buildScriptUi(scriptDir);
    expect(result.ok).toBe(true);
    expect(result.apiVersion).toBe(4);
    expect(result.dependencyHash).toMatch(/^[0-9a-f]{20}$/);
    expect(result.url).toBe(`/api/scripts/test-bundle/ui-bundle?v=${result.dependencyHash}`);
    expect(result.bundlePath).toBe(uiBundlePath("test-bundle", result.dependencyHash));
    const code = readFileSync(result.bundlePath!, "utf8");
    expect(code).toContain("/api/runtime/react.mjs");
    expect(code).toContain("/api/runtime/jsx-runtime.mjs");
    expect(code).not.toMatch(/from\s*["']react["']/);
  });

  it("returns { ok: false, error } with file/line info on a syntax error", async () => {
    const scriptDir = writeUi("test-broken", "const broken = ;");
    const result = await buildScriptUi(scriptDir);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/index\.tsx:1:\d+/);
  });

  it("returns { ok: false } when the script has no ui entry", async () => {
    const scriptDir = path.join(scriptsRoot, "no-ui");
    mkdirSync(scriptDir, { recursive: true });
    const result = await buildScriptUi(scriptDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no ui entry");
  });

  it("rejects imports outside the script and accepts the browser-safe UI API", async () => {
    writeFileSync(path.join(scriptsRoot, "outside.ts"), "export const secret = 1;");
    const escaped = writeUi("test-escape", 'import { secret } from "../../outside"; export default () => secret;');
    const rejected = await buildScriptUi(escaped);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain("escapes its boundary");

    const safe = writeUi("test-ui-api", [
      'import { SCRIPT_UI_API_VERSION, type ScriptUiContext } from "@chatgame/ui";',
      "export const apiVersion = SCRIPT_UI_API_VERSION;",
      "export default function register(_ctx: ScriptUiContext) {}",
    ].join("\n"));
    const accepted = await buildScriptUi(safe);
    expect(accepted.ok).toBe(true);
  });

  it("reuses immutable output when unchanged and invalidates on imported dependencies", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const scriptDir = writeUi("test-cache", [
        'import { label } from "./label";',
        "export const apiVersion = 3;",
        "export default function register(ctx: any) {",
        '  ctx.register("hud", { component: () => <div>{label}</div> });',
        "}",
      ].join("\n"));
      writeFileSync(path.join(scriptDir, "ui", "label.ts"), 'export const label = "first";');
      const first = await buildScriptUi(scriptDir);
      expect(first.error).toBeUndefined();
      expect(first.ok).toBe(true);
      const mtimeBefore = statSync(first.bundlePath!).mtimeMs;
      const unchanged = await buildScriptUi(scriptDir);
      expect(unchanged.bundlePath).toBe(first.bundlePath);
      expect(statSync(first.bundlePath!).mtimeMs).toBe(mtimeBefore);

      writeFileSync(path.join(scriptDir, "ui", "label.ts"), 'export const label = "second";');
      const changed = await buildScriptUi(scriptDir);
      expect(changed.ok).toBe(true);
      expect(changed.dependencyHash).not.toBe(first.dependencyHash);
      expect(changed.bundlePath).not.toBe(first.bundlePath);
      expect(readFileSync(changed.bundlePath!, "utf8")).toContain("second");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
