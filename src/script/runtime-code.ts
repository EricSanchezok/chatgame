// Script engine-extension loader: compiles scripts/<id>/engine/index.ts to
// CJS with esbuild and invokes its default export with an
// EngineExtensionContext to collect custom effect/condition/action
// handlers. Compiled output is cached under .chatgame/build/<scriptId>/
// keyed by source content hash. Errors carry file/line info from esbuild.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import type { EngineExtensionContext, ScriptExtensions } from "../engine/extensions";
import type { WorldDefinition } from "../engine/types";
import { ScriptLoadError } from "../engine/loader";

/** Build root for compiled script code (gitignored). */
export function buildDir(): string {
  return path.join(".chatgame", "build");
}

/** The engine extension entry file for a script dir (may not exist). */
export function engineEntryFile(scriptDir: string): string {
  return path.join(scriptDir, "engine", "index.ts");
}

function contentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

/**
 * Loads the script's engine extension (scripts/<id>/engine/index.ts) and
 * returns its registered handlers. Returns an empty extension when the
 * script ships no engine code. Throws ScriptLoadError with esbuild
 * file/line info on compile errors.
 */
export function loadScriptExtensions(scriptDir: string): ScriptExtensions {
  const entry = engineEntryFile(scriptDir);
  if (!existsSync(entry)) {
    return { effects: {}, conditions: {}, actionHandlers: {} };
  }

  const scriptId = path.basename(scriptDir);
  const dir = path.join(path.resolve(buildDir()), scriptId);
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, "engine.cjs");
  const hashFile = path.join(dir, "engine.hash");

  const source = readFileSync(entry, "utf8");
  const hash = contentHash(source);

  // Rebuild only when the source changed (dev always rebuilds).
  const rebuild = !existsSync(outfile) || !existsSync(hashFile) || readFileSync(hashFile, "utf8") !== hash;
  if (rebuild) {
    try {
      buildSync({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        logLevel: "silent",
      });
    } catch (err) {
      const e = err as { errors?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }> };
      const first = e.errors?.[0];
      const at = first?.location
        ? `${first.location.file ?? entry}:${first.location.line}:${first.location.column}`
        : entry;
      throw new ScriptLoadError(`script "${scriptId}" engine code failed to compile: ${at} ${first?.text ?? String(err)}`);
    }
    writeFileSync(hashFile, hash, "utf8");
  }

  // Load fresh (drop the module cache so a recompiled bundle is re-required
  // and module-level state never leaks across sessions). outfile is an
  // absolute path so require resolves it as a file, not a module name.
  const req = createRequire(path.join(process.cwd(), "noop.cjs"));
  try {
    delete req.cache[outfile];
  } catch {
    // cache miss is fine
  }
  const mod = req(outfile) as { default?: unknown };
  const register = mod.default;
  if (typeof register !== "function") {
    throw new ScriptLoadError(`script "${scriptId}" engine/index.ts must default-export a function`);
  }

  const extensions: ScriptExtensions = { effects: {}, conditions: {}, actionHandlers: {} };
  const ctx: EngineExtensionContext = {
    registerEffect: (kind, handler) => {
      extensions.effects[kind] = handler;
    },
    registerConditionSource: (source, evaluator) => {
      extensions.conditions[source] = evaluator;
    },
    registerActionHandler: (id, handler) => {
      extensions.actionHandlers[id] = handler;
    },
  };
  try {
    (register as (c: EngineExtensionContext) => void)(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ScriptLoadError(`script "${scriptId}" engine extension registration failed: ${message}`);
  }
  return extensions;
}

/** Definition shape before extensions are attached (loader assembly). */
export type DefinitionWithoutExtensions = Omit<WorldDefinition, "extensions">;

/** Attaches the script's engine extensions to a loaded definition. */
export function attachExtensions(definition: DefinitionWithoutExtensions): WorldDefinition {
  return {
    ...definition,
    extensions: loadScriptExtensions(definition.sourceDir),
  };
}
