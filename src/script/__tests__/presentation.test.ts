// Presentation-module contract tests: theme/assets schemas (hex whitelist,
// clamps, strictness) and cross-file reference checks (hard id errors vs
// soft file-existence warnings) via validateScriptDir on temp script dirs.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateScriptDir } from "../validate";
import { themeSchema, type Theme } from "../schemas/theme";
import { assetsSchema } from "../schemas/assets";

// The script id must equal the directory name, so the temp dir is fixed.
// Distinct from validate.test.ts's "testscript" to avoid parallel clashes.
const TEST_DIR = path.join(tmpdir(), "pres-testscript");
let dir: string;

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  dir = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const BASE: Record<string, string> = {
  "script.yaml": `id: pres-testscript\nname: 测试\ndescription: d\nschema_version: "1.1"\nlanguage: zh\ntone: [悬疑]\nauthor: t\n`,
  "world.yaml": "background: b\nrules: [{ id: r1, text: r, mechanism: inventory }]\ntaboos: [{ id: t1, text: t, severity: hard }]\n",
  "time.yaml": `unit: hour\nday_length_hours: 24\ncalendar: { months: [{ name: 一月, days: 31 }], weekdays: [周一] }\nschedules:\n  - id: keeper\n    entries:\n      - { from: "08:00", to: "22:00", activity: 开店, location: tavern }\nworld_advances: true\nadvance_mode: rule_based\nadvance_scope: [schedules, needs, time_events]\n`,
  "mechanics.yaml": `stats:\n  - { name: hp, min: 1, max: 100, initial: 50, description: 生命 }\n  - { name: strength, min: 1, max: 20, initial: 10, description: 力量 }\nskills:\n  - { name: persuasion, min: 0, max: 20, initial: 0, description: 说服 }\nneeds:\n  - name: hunger\n    min: 0\n    max: 100\n    initial: 80\n    decay_per_day: 20\n    thresholds: []\ninventory: { capacity: 20, stacking: true }\ncurrency: { name: 金币, symbol: "g", initial: 50 }\ncombat:\n  damage_types: [physical]\n  defense_types: [armor]\n  hp_stat: hp\n  threat_gauge: { max: 100, on_full: soft_failure }\nstatus_effects: []\n`,
  "actions.yaml": "actions:\n  - id: talk\n    enabled: true\n    resolve: { type: auto }\n    llm_freedom: narration\n",
  "plot.yaml": `commitments:\n  - id: c1\n    description: 测试承诺\n    type: secret_reveal\n    trigger:\n      condition:\n        all:\n          - { source: relationship, key: elara, op: gte, value: 60 }\n    must_happen: true\n    related:\n      secrets: []\n      npcs: [elara]\n`,
  "director.yaml": `tension:\n  variables:\n    - { name: danger, source: threat_gauge, min: 0, max: 100, initial: 10 }\nevent_selection:\n  policy: weighted_by_band\n  bands:\n    - { band: [0, 100], weight_multiplier: 1.0 }\npacing: { crisis_density: 0.3, breather_min_interval: 2, difficulty_ramp: 0.05 }\nnovelty: { seen_tracking: true, cooldown_default: 3 }\n`,
  "worldgen.yaml": `randomize:\n  - target: npc_stats\n    jitter: 0.1\nfixed: [plot_commitments, world_rules]\nseed: { policy: per_run }\n`,
  "run.yaml": `death_policy:\n  mode: soft_failure\n  soft_failure:\n    gauge_ref: threat_gauge\n    threshold: 100\n    consequence:\n      location: tavern\n      effects: []\n      narrative: 你醒来\nmeta_progression:\n  keep: [flags]\n  reset: [stats]\n  unlocks: []\nmemory:\n  tier_retention_days: { major: 0, minor: 90, trivial: 30 }\ncontext_compaction:\n  policy: summarize_archive\n  retention_tiers: [major]\n`,
  "safety.yaml": `content_classes: [violence, romance, horror, profanity, self_harm, sexual, drugs, gambling, politics, religion, crime]\nallowed:\n  violence: intense\n  romance: moderate\n  horror: intense\n  profanity: mild\n  self_harm: none\n  sexual: none\n  drugs: mild\n  gambling: moderate\n  politics: mild\n  religion: mild\n  crime: moderate\nforbidden: [self_harm, sexual]\nage_rating: "16+"\n`,
  "origins/o.yaml": `id: miner\nname: 矿工\ndescription: d\nstats: { strength: 14 }\nitems: []\nstarting_location: tavern\nstarting_currency: 30\n`,
  "npcs/elara.yaml": `id: elara\nname: 艾拉\nbase_class: humanoid\ndescription: d\nstats: { hp: 80 }\nrelations: []\nknowledge_flags: []\nllm: { personality: p, speech_patterns: [], knowledge_filter: true }\n`,
  "locations/tavern.yaml": `id: tavern\nname: 酒馆\ntype: indoor\ndescription: d\nconnections: []\ndanger_level: 1\n`,
  "locations/mine.yaml": `id: mine\nname: 矿井\ntype: outdoor\ndescription: d\nconnections: []\ndanger_level: 5\n`,
  "items/pickaxe.yaml": `id: pickaxe\nname: 镐\ntype: material\ndescription: d\nrarity: common\nvalue: 1\n`,
  "narrative/opening.yaml": "scene: s\nfirst_lines: [a]\nhooks: []\n",
  "narrative/style.yaml": "voice: v\ntense: t\nperspective: p\ndensity: normal\nsentence_style: []\nforbidden_words: []\n",
};

function writeBase(extra: Record<string, string> = {}): void {
  const files = { ...BASE, ...extra };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

const VALID_THEME = `id: default\nname: 主主题\npalette:\n  background: "#1a1410"\n  surface: "#241c15"\n  surface_alt: "#2e2218"\n  primary: "#c96f2f"\n  accent: "#e8a04c"\n  text: "#e8dcc8"\n  text_dim: "#9a8a72"\n  border: "#4a3a28"\n`;

const DARK_MINE_THEME = `id: dark-mine\nname: 暗矿\npalette:\n  background: "#0a0806"\n  surface: "#14100c"\n  surface_alt: "#1c1610"\n  primary: "#8a5a2a"\n  accent: "#c08a4a"\n  text: "#d8c8b8"\n  text_dim: "#8a7a68"\n  border: "#3a2e20"\n`;

describe("themeSchema", () => {
  it("accepts a full valid theme", () => {
    const t = themeSchema.parse({
      id: "default",
      name: "主",
      palette: { background: "#111", surface: "#222", surface_alt: "#333", primary: "#444", accent: "#555", text: "#eee", text_dim: "#999", border: "#666" },
    });
    expect(t.palette.primary).toBe("#444");
    expect(t.typography.font).toBe("sans");
    expect(t.effects.motion).toBe("subtle");
    expect(t.by_location).toEqual({});
  });

  it("rejects non-hex colors", () => {
    const bad = themeSchema.safeParse({
      id: "x",
      name: "x",
      palette: { background: "red", surface: "#222", surface_alt: "#333", primary: "#444", accent: "#555", text: "#eee", text_dim: "#999", border: "#666" },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects out-of-range scale", () => {
    const bad = themeSchema.safeParse({
      id: "x",
      name: "x",
      palette: { background: "#111", surface: "#222", surface_alt: "#333", primary: "#444", accent: "#555", text: "#eee", text_dim: "#999", border: "#666" },
      typography: { font: "serif", scale: 2.5 },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const bad = themeSchema.safeParse({
      id: "x",
      name: "x",
      palette: { background: "#111", surface: "#222", surface_alt: "#333", primary: "#444", accent: "#555", text: "#eee", text_dim: "#999", border: "#666" },
      evil: "field",
    });
    expect(bad.success).toBe(false);
  });
});

describe("assetsSchema", () => {
  it("accepts file or prompt entries (prompt-only legal)", () => {
    const a = assetsSchema.parse({
      portraits: {
        elara: { file: "assets/portraits/elara.svg", alt: "艾拉" },
        "mine-guardian": { prompt: "golem" },
      },
    });
    expect(a.portraits.elara.file).toContain(".svg");
    expect(a.portraits["mine-guardian"].prompt).toBe("golem");
  });

  it("rejects entries with neither file nor prompt", () => {
    const bad = assetsSchema.safeParse({ portraits: { elara: { alt: "x" } } });
    expect(bad.success).toBe(false);
  });

  it("rejects disallowed file extensions", () => {
    const bad = assetsSchema.safeParse({ portraits: { elara: { file: "assets/p.exe" } } });
    expect(bad.success).toBe(false);
  });
});

describe("validateScriptDir presentation modules", () => {
  it("accepts valid theme.yaml + themes/ + assets.yaml (soft warnings ok)", () => {
    writeBase({
      "theme.yaml": VALID_THEME,
      "themes/dark-mine.yaml": DARK_MINE_THEME,
      "assets.yaml": `portraits:\n  elara: { file: assets/portraits/elara.svg, alt: 艾拉 }\nbackgrounds:\n  tavern: { prompt: "steampunk tavern" }\nicons:\n  pickaxe: { file: assets/icons/pickaxe.svg }\nvoices:\n  elara: { prompt: "calm voice", profile: 低哑 }\nambient:\n  mine: { file: assets/audio/ambient/mine.mp3 }\neffects: {}\n`,
    });
    // Missing asset files are soft warnings; prompt-only entries legal.
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(true);
    const warnings = result.issues.filter((i) => i.severity === "warning");
    expect(warnings.length).toBeGreaterThan(0); // elara.svg / pickaxe.svg / mine.mp3 missing
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("fails hard on asset keys referencing unknown entities", () => {
    writeBase({
      "assets.yaml": `portraits:\n  ghost-npc: { prompt: "x" }\n`,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('npc "ghost-npc" not found'))).toBe(true);
  });

  it("fails hard on by_location referencing unknown location", () => {
    writeBase({
      "theme.yaml": `${VALID_THEME}by_location:\n  nowhere: dark-mine\n`,
      "themes/dark-mine.yaml": DARK_MINE_THEME,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('location "nowhere" not found'))).toBe(true);
  });

  it("fails hard on by_location referencing missing theme", () => {
    writeBase({
      "theme.yaml": `${VALID_THEME}by_location:\n  mine: dark-mine\n`,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('theme "dark-mine" not found'))).toBe(true);
  });

  it("fails hard on asset path escaping the script directory", () => {
    writeBase({
      "assets.yaml": `portraits:\n  elara: { file: ../outside.svg }\n`,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("inside the script directory"))).toBe(true);
  });

  it("accepts a script with no presentation modules at all", () => {
    writeBase();
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(true);
  });
});

describe("theme typing sanity", () => {
  it("Theme type exposes by_location", () => {
    const t: Theme = themeSchema.parse({
      id: "default",
      name: "主",
      palette: { background: "#111", surface: "#222", surface_alt: "#333", primary: "#444", accent: "#555", text: "#eee", text_dim: "#999", border: "#666" },
      by_location: { mine: { background: "#000" } },
    });
    expect(typeof t.by_location.mine).toBe("object");
  });
});

describe("themeSchema token v1.1", () => {
  const BASE_PALETTE = {
    background: "#111", surface: "#222", surface_alt: "#333", primary: "#444",
    accent: "#555", text: "#eee", text_dim: "#999", border: "#666",
  };

  it("applies new token defaults (effects/typography)", () => {
    const t = themeSchema.parse({ id: "x", name: "x", palette: BASE_PALETTE });
    expect(t.effects.chrome_radius).toBe(12);
    expect(t.effects.blur_px).toBe(8);
    expect(t.effects.shadow).toBe("medium");
    expect(t.effects.border_width_px).toBe(1);
    expect(t.effects.density).toBe("cozy");
    expect(t.effects.overlay_strength).toBe(0.45);
    expect(t.typography.line_height).toBe(1.6);
    expect(t.typography.letter_spacing_em).toBe(0);
    expect(t.typography.faces).toEqual([]);
    expect(t.typography.roles).toEqual({});
  });

  it("accepts a custom face + roles and clamps ranges", () => {
    const t = themeSchema.parse({
      id: "x",
      name: "x",
      palette: BASE_PALETTE,
      typography: {
        font: "serif",
        scale: 1.2,
        line_height: 1.8,
        letter_spacing_em: 0.05,
        faces: [
          { id: "runes", family: "Rune Serif", files: [{ file: "assets/fonts/rune.woff2", weight: 700, style: "italic" }] },
        ],
        roles: { ui: "runes", narrative: "runes", mono: "mono" },
      },
      effects: { bubble_radius: 20, chrome_radius: 4, glass: 0.3, blur_px: 16, shadow: "hard", border_width_px: 2, density: "compact", overlay_strength: 0.6 },
    });
    expect(t.typography.faces[0].family).toBe("Rune Serif");
    expect(t.typography.faces[0].files[0].weight).toBe(700);
    expect(t.typography.roles.narrative).toBe("runes");
    expect(t.effects.shadow).toBe("hard");
    expect(t.effects.density).toBe("compact");
  });

  it("rejects a font family with quotes/backslash (injection guard)", () => {
    const bad = themeSchema.safeParse({
      id: "x",
      name: "x",
      palette: BASE_PALETTE,
      typography: { faces: [{ id: "evil", family: 'Roboto"); background:red', files: [{ file: "assets/fonts/a.woff2" }] }] },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a font file outside assets/fonts/", () => {
    const bad = themeSchema.safeParse({
      id: "x",
      name: "x",
      palette: BASE_PALETTE,
      typography: { faces: [{ id: "f", family: "F", files: [{ file: "assets/evil.woff2" }] }] },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown effects/shadow/density/motion values", () => {
    const badShadow = themeSchema.safeParse({ id: "x", name: "x", palette: BASE_PALETTE, effects: { shadow: "huge" } });
    expect(badShadow.success).toBe(false);
    const badDensity = themeSchema.safeParse({ id: "x", name: "x", palette: BASE_PALETTE, effects: { density: "huge" } });
    expect(badDensity.success).toBe(false);
    const badOverlay = themeSchema.safeParse({ id: "x", name: "x", palette: BASE_PALETTE, effects: { overlay_strength: 1.5 } });
    expect(badOverlay.success).toBe(false);
  });
});

describe("assetsSchema ui slots", () => {
  it("accepts known ui slots with file entries", () => {
    const a = assetsSchema.parse({
      ui: { inventory: { file: "assets/icons/inventory.svg" }, map: { prompt: "map icon" } },
    });
    expect(a.ui.inventory.file).toContain("inventory.svg");
    expect(a.ui.map.prompt).toBe("map icon");
  });
});

describe("validateScriptDir presentation token checks", () => {
  it("fails hard on an unknown ui icon slot", () => {
    writeBase({
      "assets.yaml": `ui:\n  mystery-slot: { prompt: "x" }\n`,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('unknown ui icon slot "mystery-slot"'))).toBe(true);
  });

  it("fails hard on a font role referencing a missing face", () => {
    writeBase({
      "theme.yaml": `${VALID_THEME}typography:\n  roles:\n    ui: ghost-face\n`,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('font role "ghost-face"'))).toBe(true);
  });

  it("accepts a theme with a valid face (soft warning when file missing)", () => {
    writeBase({
      "theme.yaml": `${VALID_THEME}typography:\n  faces:\n    - id: runes\n      family: Rune Serif\n      files:\n        - { file: assets/fonts/rune.woff2, weight: 400, style: normal }\n  roles:\n    ui: runes\n`,
    });
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === "warning" && i.message.includes("rune.woff2"))).toBe(true);
  });
});
