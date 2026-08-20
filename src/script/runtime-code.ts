// Script engine-extension loader: compiles scripts/<id>/engine/index.ts to
// CJS with esbuild and invokes its default export with an
// EngineExtensionContext to collect custom effect/condition/action
// handlers. Bundles are content-addressed by the complete script engine
// source tree so same-id previews cannot overwrite each other. Errors carry
// file/line info from esbuild.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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

function engineDependencyHash(engineDir: string): string {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(engineDir);
  const hash = createHash("sha256").update("engine-extension-api-v2\0");
  for (const file of files.sort()) {
    hash.update(path.relative(engineDir, file)).update("\0").update(readFileSync(file)).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Loads the script's engine extension (scripts/<id>/engine/index.ts) and
 * returns its registered handlers. Returns an empty extension when the
 * script ships no engine code. Throws ScriptLoadError with esbuild
 * file/line info on compile errors.
 */
export function loadScriptExtensions(definition: DefinitionWithoutExtensions): ScriptExtensions {
  const scriptDir = definition.sourceDir;
  const entry = engineEntryFile(scriptDir);
  if (!existsSync(entry)) {
    return {
      effects: {},
      conditions: {},
      actionHandlers: {},
      ruleMechanisms: {},
      lifecycle: { sessionStart: [], turnResolved: [], hour: [], dayBoundary: [] },
    };
  }

  const scriptId = definition.script.id;
  const hash = engineDependencyHash(path.dirname(entry));
  const dir = path.join(path.resolve(buildDir()), scriptId, "engine", hash);
  const outfile = path.join(dir, "engine.cjs");

  // Rebuild only when the engine source tree changed.
  // The UI and engine build caches share a disposable root. A development
  // cleanup may remove it at any time, so a vanished bundle is an ordinary
  // cache miss rather than a script-load error.
  const compile = (): void => {
    mkdirSync(dir, { recursive: true });
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
  };
  const rebuild = !existsSync(outfile);
  if (rebuild) {
    compile();
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
  let mod: { default?: unknown };
  try {
    mod = req(outfile) as { default?: unknown };
  } catch (error) {
    // A concurrent disposable-cache cleanup can also race the require. One
    // rebuild is safe because the source bundle is deterministic.
    if (!existsSync(outfile)) {
      compile();
      delete req.cache[outfile];
      mod = req(outfile) as { default?: unknown };
    } else {
      throw error;
    }
  }
  const register = mod.default;
  if (typeof register !== "function") {
    throw new ScriptLoadError(`script "${scriptId}" engine/index.ts must default-export a function`);
  }

  const extensions: ScriptExtensions = {
    effects: {},
    conditions: {},
    actionHandlers: {},
    ruleMechanisms: {},
    lifecycle: { sessionStart: [], turnResolved: [], hour: [], dayBoundary: [] },
  };
  const registerUnique = <T>(
    registry: Record<string, T>,
    kind: string,
    id: string,
    handler: T,
  ): void => {
    if (Object.hasOwn(registry, id)) {
      throw new Error(`duplicate ${kind} registration "${id}"`);
    }
    registry[id] = handler;
  };
  const ctx: EngineExtensionContext = {
    registerEffect: (kind, handler) => {
      registerUnique(extensions.effects, "effect", kind, handler);
    },
    registerConditionSource: (source, evaluator) => {
      registerUnique(extensions.conditions, "condition source", source, evaluator);
    },
    registerActionHandler: (id, handler) => {
      registerUnique(extensions.actionHandlers, "action handler", id, handler);
    },
    registerRuleMechanism: (id, checker) => {
      registerUnique(extensions.ruleMechanisms, "rule mechanism", id, checker);
    },
    onSessionStart: (handler) => extensions.lifecycle.sessionStart.push(handler),
    onTurnResolved: (handler) => extensions.lifecycle.turnResolved.push(handler),
    onHour: (handler) => extensions.lifecycle.hour.push(handler),
    onDayBoundary: (handler) => extensions.lifecycle.dayBoundary.push(handler),
  };
  try {
    (register as (c: EngineExtensionContext) => void)(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ScriptLoadError(`script "${scriptId}" engine extension registration failed: ${message}`);
  }
  verifyDeclaredExtension(definition, extensions);
  return extensions;
}

function verifyDeclaredExtension(
  definition: DefinitionWithoutExtensions,
  extensions: ScriptExtensions,
): void {
  const declared = definition.script.engine_extension;
  if (!declared) {
    throw new ScriptLoadError(
      `script "${definition.script.id}" has engine code but no engine_extension API v2 declaration`,
    );
  }
  const assertKeys = (label: string, expected: readonly string[], actual: Record<string, unknown>) => {
    const expectedKeys = [...expected].sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.join("\0") !== actualKeys.join("\0")) {
      throw new ScriptLoadError(
        `script "${definition.script.id}" ${label} declaration does not match registrations ` +
          `(declared: ${expectedKeys.join(", ") || "none"}; registered: ${actualKeys.join(", ") || "none"})`,
      );
    }
  };
  assertKeys("effects", declared.effects, extensions.effects);
  assertKeys("conditions", declared.conditions, extensions.conditions);
  assertKeys("action handlers", declared.action_handlers, extensions.actionHandlers);
  assertKeys("rule mechanisms", declared.rule_mechanisms, extensions.ruleMechanisms);
  const lifecycleMap = {
    session_start: extensions.lifecycle.sessionStart,
    turn_resolved: extensions.lifecycle.turnResolved,
    hour: extensions.lifecycle.hour,
    day_boundary: extensions.lifecycle.dayBoundary,
  } as const;
  for (const [phase, handlers] of Object.entries(lifecycleMap)) {
    const isDeclared = declared.lifecycle.includes(phase as (typeof declared.lifecycle)[number]);
    if (isDeclared !== (handlers.length > 0)) {
      throw new ScriptLoadError(
        `script "${definition.script.id}" lifecycle "${phase}" declaration does not match registrations`,
      );
    }
  }
}

/** Definition shape before extensions are attached (loader assembly). */
export type DefinitionWithoutExtensions = Omit<WorldDefinition, "extensions">;

/** Attaches the script's engine extensions to a loaded definition. */
export function attachExtensions(definition: DefinitionWithoutExtensions): WorldDefinition {
  return {
    ...definition,
    extensions: loadScriptExtensions(definition),
  };
}
