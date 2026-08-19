// Script loader: validates a script directory through the contract layer
// (src/script/validate.ts) and assembles an indexed WorldDefinition.
// The contract layer stays read-only — the engine only consumes it.
import path from "node:path";
import { existsSync } from "node:fs";
import { validateScriptDir } from "../script/validate";
import {
  actionsSchema,
  directorSchema,
  eventSchema,
  factionSchema,
  itemSchema,
  locationSchema,
  mechanicsSchema,
  npcSchema,
  originSchema,
  plotSchema,
  runSchema,
  safetySchema,
  scriptSchema,
  styleSchema,
  taskSchema,
  timeSchema,
  worldSchema,
  worldgenSchema,
  loreEntrySchema,
  exampleDialogueSchema,
  eventTextSchema,
  openingSchema,
  themeSchema,
  assetsSchema,
 } from "../script/schemas";
import { loadYamlFilesFromDir, loadYamlFile } from "../script/loader";
import type { WorldDefinition } from "./types";

export class ScriptLoadError extends Error {}

/** Parses one YAML root module and returns typed data (throws on failure). */
function parseRoot<T>(absPath: string, relPath: string, schema: { parse: (v: unknown) => T }): T {
  const file = loadYamlFile(absPath, relPath);
  return schema.parse(file.doc.toJS());
}

/** Parses every file in an optional entity directory into a Map by id. */
function parseDir<T extends { id: string }>(
  scriptDir: string,
  dirName: string,
  schema: { parse: (v: unknown) => T },
): Map<string, T> {
  const map = new Map<string, T>();
  const files = loadYamlFilesFromDir(path.join(scriptDir, dirName), dirName);
  for (const file of files) {
    const entity = schema.parse(file.doc.toJS());
    if (map.has(entity.id)) {
      throw new ScriptLoadError(`duplicate entity id "${entity.id}" in ${dirName}/`);
    }
    map.set(entity.id, entity);
  }
  return map;
}

/** Loads and fully validates a script directory into a WorldDefinition. */
export function loadScript(scriptDir: string): WorldDefinition {
  const absDir = path.resolve(scriptDir);
  const validation = validateScriptDir(absDir);
  if (!validation.ok) {
    const first = validation.issues[0];
    const at = first.line !== undefined ? `:${first.line}` : "";
    throw new ScriptLoadError(
      `script "${scriptDir}" failed validation: ${first.file}${at} [${first.path}] ${first.message}` +
        (validation.issues.length > 1 ? ` (+${validation.issues.length - 1} more)` : ""),
    );
  }

  try {
    const script = parseRoot(path.join(absDir, "script.yaml"), "script.yaml", scriptSchema);
    const world = parseRoot(path.join(absDir, "world.yaml"), "world.yaml", worldSchema);
    const time = parseRoot(path.join(absDir, "time.yaml"), "time.yaml", timeSchema);
    const mechanics = parseRoot(path.join(absDir, "mechanics.yaml"), "mechanics.yaml", mechanicsSchema);
    const actions = parseRoot(path.join(absDir, "actions.yaml"), "actions.yaml", actionsSchema);
    const plot = parseRoot(path.join(absDir, "plot.yaml"), "plot.yaml", plotSchema);
    const director = parseRoot(path.join(absDir, "director.yaml"), "director.yaml", directorSchema);
    const worldgen = parseRoot(path.join(absDir, "worldgen.yaml"), "worldgen.yaml", worldgenSchema);
    const run = parseRoot(path.join(absDir, "run.yaml"), "run.yaml", runSchema);
    const safety = parseRoot(path.join(absDir, "safety.yaml"), "safety.yaml", safetySchema);

    const origins = parseDir(absDir, "origins", originSchema);
    const npcs = parseDir(absDir, "npcs", npcSchema);
    const locations = parseDir(absDir, "locations", locationSchema);
    const items = parseDir(absDir, "items", itemSchema);
    const factions = parseDir(absDir, "factions", factionSchema);
    const events = parseDir(absDir, "events", eventSchema);
    const tasks = parseDir(absDir, "tasks", taskSchema);

    const narrativeBase = path.join(absDir, "narrative");
    const opening = parseRoot(
      path.join(narrativeBase, "opening.yaml"),
      "narrative/opening.yaml",
      openingSchema,
    );
    const style = parseRoot(
      path.join(narrativeBase, "style.yaml"),
      "narrative/style.yaml",
      styleSchema,
    );
    const lore: Array<ReturnType<typeof loreEntrySchema.parse>> = [];
    for (const file of loadYamlFilesFromDir(path.join(narrativeBase, "lore"), "narrative/lore")) {
      lore.push(loreEntrySchema.parse(file.doc.toJS()));
    }
    const examples: Array<ReturnType<typeof exampleDialogueSchema.parse>> = [];
    for (const file of loadYamlFilesFromDir(path.join(narrativeBase, "examples"), "narrative/examples")) {
      examples.push(exampleDialogueSchema.parse(file.doc.toJS()));
    }
    const eventTexts: Array<ReturnType<typeof eventTextSchema.parse>> = [];
    for (const file of loadYamlFilesFromDir(path.join(narrativeBase, "event_texts"), "narrative/event_texts")) {
      eventTexts.push(eventTextSchema.parse(file.doc.toJS()));
    }

    // Presentation modules (optional): theme.yaml default + themes/* + assets.yaml.
    const themes = new Map<string, ReturnType<typeof themeSchema.parse>>();
    for (const themeFile of loadYamlFilesFromDir(path.join(absDir, "themes"), "themes")) {
      const t = themeSchema.parse(themeFile.doc.toJS());
      if (themes.has(t.id)) {
        throw new ScriptLoadError(`duplicate theme id "${t.id}"`);
      }
      themes.set(t.id, t);
    }
    if (existsSync(path.join(absDir, "theme.yaml"))) {
      const rootTheme = parseRoot(path.join(absDir, "theme.yaml"), "theme.yaml", themeSchema);
      if (themes.has(rootTheme.id)) {
        throw new ScriptLoadError(`duplicate theme id "${rootTheme.id}" (theme.yaml + themes/)`);
      }
      themes.set(rootTheme.id, rootTheme);
    }
    let assets: ReturnType<typeof assetsSchema.parse> | undefined;
    if (existsSync(path.join(absDir, "assets.yaml"))) {
      assets = parseRoot(path.join(absDir, "assets.yaml"), "assets.yaml", assetsSchema);
    }
    return {
      script,
      world,
      time,
      mechanics,
      actions,
      plot,
      director,
      worldgen,
      run,
      safety,
      origins,
      npcs,
      locations,
      items,
      factions,
      events,
      tasks,
      narrative: { opening, style, lore, examples, eventTexts },
      themes,
      assets,
      sourceDir: absDir,
    };
  } catch (err) {
    if (err instanceof ScriptLoadError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ScriptLoadError(`script "${scriptDir}" could not be parsed: ${message}`);
  }
}
