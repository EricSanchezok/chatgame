// Presentation-module semantic validation for script directories:
// theme.yaml / themes/ (id references) and assets.yaml (entity references
// + file existence). Kept separate from validate.ts so the two concerns
// stay below the per-file size budget.
import { existsSync } from "node:fs";
import path from "node:path";
import type { LoadedYamlFile } from "./loader";
import type { Theme } from "./schemas/theme";
import type { AssetsManifest } from "./schemas/assets";
import { ASSET_KIND_ENTITY_POOL } from "./schemas/assets";

export interface PresentationIssue {
  file: string;
  line?: number;
  path: string;
  message: string;
  /** "error" fails validation; "warning" is informational (e.g. missing asset file). */
  severity: "error" | "warning";
}

export interface ThemeModule {
  file: LoadedYamlFile;
  data: Theme;
}

export interface PresentationModules {
  /** Root theme.yaml (the script default theme). */
  theme?: ThemeModule;
  /** Extra themes from themes/*.yaml. */
  themes: ThemeModule[];
  /** assets.yaml manifest. */
  assets?: { file: LoadedYamlFile; data: AssetsManifest };
}

/**
 * Cross-checks presentation modules against entity pools.
 * Warnings never invalidate the script; errors do.
 */
export function checkPresentationModules(
  scriptDir: string,
  mods: PresentationModules,
  pools: {
    npcIds: Set<string>;
    locationIds: Set<string>;
    itemIds: Set<string>;
    eventIds: Set<string>;
  },
): PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  const add = (
    file: string,
    severity: "error" | "warning",
    path: string,
    message: string,
  ) => issues.push({ file, severity, path, message });

  const themeIds = new Set<string>();
  if (mods.theme) themeIds.add(mods.theme.data.id);
  for (const t of mods.themes) themeIds.add(t.data.id);

  // --- theme.yaml / themes/: by_location references must exist ---
  for (const [theme, file] of [
    ...(mods.theme ? [[mods.theme.data, mods.theme.file] as const] : []),
    ...mods.themes.map((m) => [m.data, m.file] as const),
  ]) {
    for (const [locId, value] of Object.entries(theme.by_location)) {
      if (!pools.locationIds.has(locId)) {
        add(
          file.relPath,
          "error",
          `by_location.${locId}`,
          `location "${locId}" not found in locations/`,
        );
      }
      if (typeof value === "string" && value !== theme.id && !themeIds.has(value)) {
        add(
          file.relPath,
          "error",
          `by_location.${locId}`,
          `theme "${value}" not found (expected theme.yaml or themes/<id>.yaml)`,
        );
      }
    }
  }

  // --- assets.yaml: entity id references (hard) + file existence (soft) ---
  const assets = mods.assets;
  if (!assets) return issues;
  const assetFile = assets.file.relPath;

  for (const [kind, poolKey] of Object.entries(ASSET_KIND_ENTITY_POOL)) {
    const pool = pools[`${poolKey}Ids` as "npcIds" | "locationIds" | "itemIds" | "eventIds"];
    const section = (assets.data as unknown as Record<string, Record<string, { file?: string }>>)[kind];
    for (const [key, entry] of Object.entries(section)) {
      if (!pool.has(key)) {
        add(assetFile, "error", `${kind}.${key}`, `${poolKey} "${key}" not found`);
        continue;
      }
      if (entry.file) {
        const abs = path.resolve(scriptDir, entry.file);
        const within = abs.startsWith(path.resolve(scriptDir) + path.sep);
        if (!within) {
          add(assetFile, "error", `${kind}.${key}.file`, `asset path must stay inside the script directory`);
          continue;
        }
        if (!existsSync(abs)) {
          add(assetFile, "warning", `${kind}.${key}.file`, `asset file "${entry.file}" not found (prompt placeholder or missing file)`);
        }
      }
    }
  }

  return issues;
}
