import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { ModelCatalog } from "../engine/model-catalog";
import type { WorldImportResult } from "./world-import";

const BUNDLED_WORLDS = [{
  id: "blackmarsh",
  directory: "blackmarsh/world",
}] as const;

interface FreshWorldCatalog {
  readonly created: boolean;
  importWorld(
    buffer: Buffer,
    modelCatalog: ModelCatalog,
    replace?: boolean,
    expectedWorldId?: string,
  ): WorldImportResult;
}

export function archiveWorldDirectory(directory: string): Buffer {
  const archive = new AdmZip();
  const addDirectory = (current: string, relative: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current, entry.name);
      const entryRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) addDirectory(absolute, entryRelative);
      else archive.addFile(path.posix.join("world", entryRelative), readFileSync(absolute));
    }
  };
  addDirectory(directory, "");
  return archive.toBuffer();
}

export function installBundledWorlds(
  catalog: FreshWorldCatalog,
  modelCatalog: ModelCatalog,
  worldsRoot = path.resolve("worlds"),
): WorldImportResult[] {
  if (!catalog.created) return [];
  return BUNDLED_WORLDS.map((world) => catalog.importWorld(
    archiveWorldDirectory(path.join(/* turbopackIgnore: true */ worldsRoot, world.directory)),
    modelCatalog,
    false,
    world.id,
  ));
}
