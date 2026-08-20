import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export const CORE_TEST_SCRIPT_DIR = path.resolve(
  __dirname,
  "../../../../test/fixtures/core-test-library/core-test-script",
);

export const TEST_SCRIPT_ID = "host-fixture";
export const TEST_ORIGIN_ID = "observer";
export const TEST_ALT_ORIGIN_ID = "alternate-observer";

const ASSETS_MANIFEST = `cover:
  file: assets/backgrounds/test-stage.svg
  alt: 通用平台测试封面
backgrounds:
  relay-room:
    file: assets/backgrounds/test-stage.svg
    alt: 通用平台测试中继室
`;

const TEST_STAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 36"><title>test stage</title></svg>`;

const RELAY_FACTION = `id: relay-crew
name: 中继值班组
description: 仅用于验证通用宿主目录契约的测试派系。
goals: [保持测试可重复]
members: [operator]
relations: []
reputation:
  thresholds: []
  decay: 0
`;

const ALT_ORIGIN = `id: alternate-observer
name: 备用观察员
description: 用于验证宿主元进度解锁合并。
difficulty: 标准
skills:
  focus: 7
items: []
starting_location: relay-room
starting_currency: 3
starting_relations:
  - npc: operator
    value: 10
    type: 同班
starting_knowledge: []
exclusive_leads: []
denied_actions: []
`;

const RUN_OVERLAY = `death_policy:
  mode: hard_reset
  hard_reset:
    world_reroll: reroll_worldgen
meta_progression:
  keep: [flags, lore, relations_overview]
  reset: [stats, inventory, location, currency]
  unlocks:
    - flag: returned_visitor
      grant: [alternate-observer]
memory:
  tier_retention_days:
    major: 0
    minor: 30
    trivial: 7
context_compaction:
  policy: summarize_archive
  retention_tiers: [major]
`;

const DAY_BOUNDARY_ENGINE = `export default function register(context: any): void {
  context.onSessionStart((state: any) => ({
    state: { ...state, runtimeState: { ...state.runtimeState, coreTestEngine: "v2-ready" } },
    summaries: ["core test Engine API v2 session_start completed"],
  }));
  context.onDayBoundary((state: any) => ({
    state: { ...state, player: { ...state.player, locationId: "service-corridor" } },
    summaries: ["core test day boundary moved the observer"],
  }));
}
`;

/** Adds a day-boundary location transition and matching by-location theme. */
export function applyAdvancePresentationOverlay(destination: string): void {
  const scriptPath = path.join(destination, "script.yaml");
  writeFileSync(
    scriptPath,
    readFileSync(scriptPath, "utf8")
      .replace("lifecycle: [session_start]", "lifecycle: [session_start, day_boundary]"),
  );
  writeFileSync(path.join(destination, "engine", "index.ts"), DAY_BOUNDARY_ENGINE);
  const defaultThemePath = path.join(destination, "theme.yaml");
  const defaultTheme = readFileSync(defaultThemePath, "utf8");
  mkdirSync(path.join(destination, "themes"), { recursive: true });
  writeFileSync(
    path.join(destination, "themes", "service-corridor.yaml"),
    defaultTheme
      .replace(/^id: default$/m, "id: service-corridor")
      .replace(/^name: .+$/m, "name: 维护走廊")
      .replace('background: "#0d1113"', 'background: "#111827"')
      .replace('scene_tint: "#111719"', 'scene_tint: "#172033"'),
  );
  writeFileSync(
    defaultThemePath,
    `${defaultTheme.trimEnd()}\nby_location:\n  service-corridor: service-corridor\n`,
  );
}

/** Copies the shared core script and applies server-test-only presentation/run overlays. */
export function copyCoreTestScript(destination: string, scriptId = TEST_SCRIPT_ID): void {
  cpSync(CORE_TEST_SCRIPT_DIR, destination, { recursive: true });
  const scriptPath = path.join(destination, "script.yaml");
  writeFileSync(
    scriptPath,
    readFileSync(scriptPath, "utf8")
      .replace(/^id: core-test-script$/m, `id: ${scriptId}`),
  );
  applyAdvancePresentationOverlay(destination);

  mkdirSync(path.join(destination, "assets", "backgrounds"), { recursive: true });
  writeFileSync(path.join(destination, "assets.yaml"), ASSETS_MANIFEST);
  writeFileSync(path.join(destination, "assets", "backgrounds", "test-stage.svg"), TEST_STAGE_SVG);

  mkdirSync(path.join(destination, "factions"), { recursive: true });
  writeFileSync(path.join(destination, "factions", "relay-crew.yaml"), RELAY_FACTION);
  writeFileSync(path.join(destination, "origins", `${TEST_ALT_ORIGIN_ID}.yaml`), ALT_ORIGIN);
  writeFileSync(path.join(destination, "run.yaml"), RUN_OVERLAY);
}

/** Collects all files below a prepared fixture directory. */
export function walkFixtureFiles(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = path.join(dir, entry);
    const relative = base ? `${base}/${entry}` : entry;
    return statSync(absolute).isDirectory()
      ? walkFixtureFiles(absolute, relative)
      : [relative];
  });
}

/** Produces complete provenance for the local asset files in a prepared fixture. */
export function fixtureProvenance(scriptDir: string): string {
  const files = walkFixtureFiles(path.join(scriptDir, "assets"), "assets")
    .filter((file) => file !== "assets/provenance.yaml");
  return [
    "version: 1",
    "files:",
    ...files.flatMap((file) => [
      `  ${JSON.stringify(file)}:`,
      "    source: chatgame test fixture",
      "    license: test-only",
    ]),
    "",
  ].join("\n");
}

/** Packages a prepared core-script copy under a caller-selected script id. */
export function coreTestScriptZip(
  sourceDir: string,
  scriptId = TEST_SCRIPT_ID,
  options: { provenance?: boolean } = { provenance: true },
): Buffer {
  const zip = new AdmZip();
  for (const relative of walkFixtureFiles(sourceDir)) {
    const content = readFileSync(path.join(sourceDir, relative));
    zip.addFile(
      `${scriptId}/${relative}`,
      relative === "script.yaml"
        ? Buffer.from(content.toString("utf8").replace(/^id: .+$/m, `id: ${scriptId}`))
        : content,
    );
  }
  if (options.provenance !== false) {
    zip.addFile(`${scriptId}/assets/provenance.yaml`, Buffer.from(fixtureProvenance(sourceDir)));
  }
  return zip.toBuffer();
}
