// Script UI build pipeline: compiles a script's ui/index.ts(x) extension into
// a browser ESM bundle with React externalized to the host runtime shims.
// The version is a hash of every local file in esbuild's dependency graph,
// plus the UI API version, so imports invalidate the URL as reliably as the
// entry file itself.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build, type BuildFailure, type Metafile, type Plugin } from "esbuild";
import { SCRIPT_UI_API_VERSION } from "../shared/client-dto";

export interface ScriptUiBuildResult {
  ok: boolean;
  apiVersion?: typeof SCRIPT_UI_API_VERSION;
  dependencyHash?: string;
  url?: string;
  bundlePath?: string;
  error?: string;
}

/** Rewrites bare React imports to runtime shims owned by the host. */
export function rewriteReactImports(code: string): string {
  return code
    .replace(/from\s*"react\/jsx-runtime"/g, 'from "/api/runtime/jsx-runtime.mjs"')
    .replace(/from\s*"react"/g, 'from "/api/runtime/react.mjs"')
    .replace(/from\s*'react\/jsx-runtime'/g, "from '/api/runtime/jsx-runtime.mjs'")
    .replace(/from\s*'react'/g, "from '/api/runtime/react.mjs'");
}

/** Rewrites the public UI package to the single browser runtime owned by the host. */
export function rewriteUiRuntimeImport(code: string): string {
  return code
    .replace(/from\s*"@chatgame\/ui"/g, 'from "/api/runtime/ui.mjs"')
    .replace(/from\s*'@chatgame\/ui'/g, 'from "/api/runtime/ui.mjs"');
}

/** Path for an immutable bundle version. */
export function uiBundlePath(scriptId: string, dependencyHash = "current"): string {
  return path.join(".chatgame", "build", scriptId, `ui-${dependencyHash}.mjs`);
}

function findUiEntry(scriptDir: string): string | undefined {
  for (const name of ["index.tsx", "index.ts"]) {
    const entry = path.join(scriptDir, "ui", name);
    if (existsSync(entry)) return entry;
  }
  return undefined;
}

function formatEsbuildError(err: unknown): string {
  const failure = err as BuildFailure | undefined;
  const first = failure?.errors?.[0];
  const loc = first?.location;
  const where = loc ? `${loc.file ?? "ui entry"}:${loc.line ?? "?"}:${loc.column ?? "?"}` : "";
  const what = first?.text ?? (err instanceof Error ? err.message : String(err));
  return where ? `${where}: ${what}` : what;
}

function dependencyGraphHash(metafile: Metafile, scriptDir: string): string {
  const digest = createHash("sha256");
  digest.update(`script-ui-api:${SCRIPT_UI_API_VERSION}\n`);
  for (const input of Object.keys(metafile.inputs).sort()) {
    const absolute = path.resolve(input);
    const relative = path.relative(scriptDir, absolute).split(path.sep).join("/");
    digest.update(relative);
    digest.update("\0");
    digest.update(readFileSync(absolute));
    digest.update("\0");
  }
  return digest.digest("hex").slice(0, 20);
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function scriptUiBoundary(scriptDir: string): Plugin {
  const root = realpathSync(path.resolve(scriptDir));
  return {
    name: "chatgame-script-ui-boundary",
    setup(builder) {
      builder.onResolve({ filter: /^@chatgame\/ui$/ }, () => ({ path: "@chatgame/ui", external: true }));
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        if (args.path === "react" || args.path === "react/jsx-runtime") {
          return { path: args.path, external: true };
        }
        if (args.path.startsWith(".")) {
          const importerDir = realpathSync(path.dirname(args.importer));
          const target = path.resolve(importerDir, args.path);
          if (inside(root, target)) return undefined;
          return { errors: [{ text: `script UI import escapes its boundary: ${args.path}` }] };
        }
        return { errors: [{ text: `script UI import is not allowed: ${args.path}` }] };
      });
    },
  };
}

/**
 * Compiles a script UI extension. A missing extension is a supported fallback
 * condition and returns ok:false; compilation failures never escape to callers.
 */
export async function buildScriptUi(scriptDir: string): Promise<ScriptUiBuildResult> {
  const entry = findUiEntry(scriptDir);
  if (!entry) {
    return { ok: false, error: "script has no ui entry (expected ui/index.ts or ui/index.tsx)" };
  }
  const scriptId = path.basename(scriptDir);
  try {
    const result = await build({
      absWorkingDir: process.cwd(),
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      jsx: "automatic",
      platform: "browser",
      external: ["react", "react/jsx-runtime", "@chatgame/ui"],
      plugins: [scriptUiBoundary(scriptDir)],
      logLevel: "silent",
      metafile: true,
      write: false,
    });
    const output = result.outputFiles?.[0];
    if (!output || !result.metafile) {
      return { ok: false, error: "esbuild produced no output or dependency graph" };
    }
    const dependencyHash = dependencyGraphHash(result.metafile, path.resolve(scriptDir));
    const bundlePath = uiBundlePath(scriptId, dependencyHash);
    if (!existsSync(bundlePath)) {
      const code = rewriteUiRuntimeImport(rewriteReactImports(output.text));
      mkdirSync(path.dirname(bundlePath), { recursive: true });
      writeFileSync(bundlePath, code);
    }
    return {
      ok: true,
      apiVersion: SCRIPT_UI_API_VERSION,
      dependencyHash,
      url: `/api/scripts/${encodeURIComponent(scriptId)}/ui-bundle?v=${dependencyHash}`,
      bundlePath,
    };
  } catch (err) {
    return { ok: false, error: formatEsbuildError(err) };
  }
}
