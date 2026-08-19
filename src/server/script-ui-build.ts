// Script UI build pipeline: compiles a script's ui/index.ts(x) extension into
// a browser ESM bundle with react externalized to the host runtime shims.
// Output is cached under .chatgame/build/<scriptId>/ keyed by a sha256 prefix
// of the entry file; dev mode always recompiles.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build, type BuildFailure } from "esbuild";

export interface ScriptUiBuildResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Rewrites bare react imports to the shared runtime shim URLs (both quote styles). */
export function rewriteReactImports(code: string): string {
  return code
    .replace(/from\s*"react\/jsx-runtime"/g, 'from "/api/runtime/jsx-runtime.mjs"')
    .replace(/from\s*"react"/g, 'from "/api/runtime/react.mjs"')
    .replace(/from\s*'react\/jsx-runtime'/g, "from '/api/runtime/jsx-runtime.mjs'")
    .replace(/from\s*'react'/g, "from '/api/runtime/react.mjs'");
}

/** Path of the built bundle for a script (cwd-relative, like other .chatgame dirs). */
export function uiBundlePath(scriptId: string): string {
  return path.join(".chatgame", "build", scriptId, "ui.mjs");
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 12);
}

function findUiEntry(scriptDir: string): string | undefined {
  for (const name of ["index.tsx", "index.ts"]) {
    const entry = path.join(scriptDir, "ui", name);
    if (existsSync(entry)) return entry;
  }
  return undefined;
}

/** Formats an esbuild failure as "file:line:column: message". */
function formatEsbuildError(err: unknown): string {
  const failure = err as BuildFailure | undefined;
  const first = failure?.errors?.[0];
  const loc = first?.location;
  const where = loc ? `${loc.file ?? "ui entry"}:${loc.line ?? "?"}:${loc.column ?? "?"}` : "";
  const what = first?.text ?? (err instanceof Error ? err.message : String(err));
  return where ? `${where}: ${what}` : what;
}

/**
 * Compiles a script's ui extension into a browser ESM bundle. Never throws —
 * failures come back as { ok: false, error } so callers degrade gracefully.
 */
export async function buildScriptUi(scriptDir: string): Promise<ScriptUiBuildResult> {
  const entry = findUiEntry(scriptDir);
  if (!entry) {
    return { ok: false, error: "script has no ui entry (expected ui/index.ts or ui/index.tsx)" };
  }
  const scriptId = path.basename(scriptDir);
  const sourceHash = hashFile(entry);
  const bundlePath = uiBundlePath(scriptId);
  const hashPath = path.join(path.dirname(bundlePath), "ui.hash");
  if (
    process.env.NODE_ENV === "production" &&
    existsSync(bundlePath) &&
    existsSync(hashPath) &&
    readFileSync(hashPath, "utf8") === sourceHash
  ) {
    return { ok: true, url: `/api/scripts/${scriptId}/ui-bundle` };
  }
  try {
    const result = await build({
      entryPoints: [entry],
      outfile: bundlePath,
      bundle: true,
      format: "esm",
      jsx: "automatic",
      platform: "browser",
      external: ["react", "react-dom", "react/jsx-runtime"],
      logLevel: "silent",
      write: false,
    });
    const output = result.outputFiles?.[0];
    if (!output) {
      return { ok: false, error: "esbuild produced no output" };
    }
    const code = rewriteReactImports(output.text);
    mkdirSync(path.dirname(bundlePath), { recursive: true });
    writeFileSync(bundlePath, code);
    writeFileSync(hashPath, sourceHash);
    return { ok: true, url: `/api/scripts/${scriptId}/ui-bundle` };
  } catch (err) {
    return { ok: false, error: formatEsbuildError(err) };
  }
}
