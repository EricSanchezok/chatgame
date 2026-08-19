// Semantic validation tests: reference integrity edges (appendix E),
// id uniqueness, schema_version strict match, ID naming, and the
// destructive-sample set. Uses a fixture directory constructed in-memory
// on disk under the OS temp dir.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateScriptDir } from "../validate";

/** Minimal valid script skeleton (all required root modules + 1 origin/npc/location). */
function validBase(): Record<string, string> {
  return {
    "script.yaml": `
id: testscript
name: 测试世界
description: 用于语义校验测试
schema_version: "1.1"
language: zh
tone: [悬疑]
author: test
`,
    "world.yaml": `
background: 测试世界背景
rules:
  - id: r1
    text: 规则一
    mechanism: inventory
taboos:
  - id: t1
    text: 禁忌一
    severity: hard
glossary:
  - term: 测试
    aliases: []
    definition: 定义
`,
    "time.yaml": `
unit: hour
day_length_hours: 24
calendar:
  months:
    - { name: 一月, days: 31 }
  weekdays: [周一]
schedules:
  - id: keeper
    entries:
      - { from: "08:00", to: "22:00", activity: 开店, location: tavern }
world_advances: true
advance_mode: rule_based
advance_scope: [schedules, needs, time_events]
`,
    "mechanics.yaml": `
stats:
  - { name: hp, min: 1, max: 100, initial: 50, description: 生命 }
  - { name: strength, min: 1, max: 20, initial: 10, description: 力量 }
skills:
  - { name: persuasion, min: 0, max: 20, initial: 0, description: 说服 }
needs:
  - name: hunger
    min: 0
    max: 100
    initial: 80
    decay_per_day: 20
    thresholds: []
inventory: { capacity: 20, stacking: true }
currency: { name: 金币, symbol: "g", initial: 50 }
combat:
  damage_types: [physical]
  defense_types: [armor]
  hp_stat: hp
  threat_gauge: { max: 100, on_full: soft_failure }
`,
    "actions.yaml": `
actions:
  - id: talk
    enabled: true
    resolve: { type: auto }
    llm_freedom: narration
  - id: persuade
    enabled: true
    resolve: { type: skill_check, skill: persuasion, dc: 12 }
    llm_freedom: narration
  - id: attack
    enabled: true
    resolve: { type: stat_check, stat: strength, dc: 12 }
    effects:
      - { kind: stat, direction: add, target: npc1, stat: hp, value: -5 }
    llm_freedom: process
`,
    "plot.yaml": `
commitments:
  - id: c1
    description: 测试承诺
    type: secret_reveal
    trigger:
      condition:
        all:
          - { source: relationship, key: npc1, op: gte, value: 60 }
    must_happen: true
    related:
      secrets: [s1]
      npcs: [npc1]
`,
    "director.yaml": `
tension:
  variables:
    - { name: danger, source: threat_gauge, min: 0, max: 100, initial: 10 }
event_selection:
  policy: weighted_by_band
  bands:
    - { band: [0, 100], weight_multiplier: 1.0 }
pacing: { crisis_density: 0.3, breather_min_interval: 2, difficulty_ramp: 0.05 }
novelty: { seen_tracking: true, cooldown_default: 3 }
`,
    "worldgen.yaml": `
randomize:
  - target: npc_stats
    jitter: 0.1
fixed: [plot_commitments, world_rules]
seed: { policy: per_run }
`,
    "run.yaml": `
death_policy:
  mode: soft_failure
  soft_failure:
    gauge_ref: threat_gauge
    threshold: 100
    consequence:
      location: tavern
      effects: []
      narrative: 你醒来
meta_progression:
  keep: [flags]
  reset: [stats]
  unlocks: []
memory:
  tier_retention_days: { major: 0, minor: 90, trivial: 30 }
context_compaction:
  policy: summarize_archive
  retention_tiers: [major]
`,
    "safety.yaml": `
content_classes: [violence, romance, horror, profanity, self_harm, sexual, drugs, gambling, politics, religion, crime]
allowed:
  violence: intense
  romance: moderate
  horror: intense
  profanity: mild
  self_harm: none
  sexual: none
  drugs: mild
  gambling: moderate
  politics: mild
  religion: mild
  crime: moderate
forbidden: [self_harm, sexual]
age_rating: "16+"
`,
    "origins/o1.yaml": `
id: o1
name: 测试出身
description: 测试
stats: { strength: 14 }
items: [item1]
starting_location: tavern
starting_currency: 30
`,
    "npcs/npc1.yaml": `
id: npc1
name: 测试NPC
base_class: humanoid
description: 测试
stats: { hp: 80 }
occupation: keeper
schedule: keeper
home: tavern
relations: []
memory:
  initial:
    - { text: 记忆, importance: major, tags: [tag] }
secrets:
  - id: s1
    content: 秘密
    reveal:
      logic:
        all:
          - { source: relationship, key: player, op: gte, value: 60 }
knowledge_flags: []
llm:
  personality: 测试
  speech_patterns: []
  knowledge_filter: true
`,
    "locations/tavern.yaml": `
id: tavern
name: 酒馆
type: indoor
description: 测试地点
connections: []
danger_level: 1
`,
    "items/item1.yaml": `
id: item1
name: 测试物品
type: material
description: 测试
rarity: common
value: 5
`,
    "narrative/opening.yaml": `
scene: 清晨
first_lines: []
hooks: []
`,
    "narrative/style.yaml": `
voice: 第三人称
tense: 现在时
perspective: 主角
density: normal
sentence_style: []
forbidden_words: []
`,
  };
}

let dir: string;
const TEST_DIR = path.join(tmpdir(), "testscript");
beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  dir = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeScript(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

function expectIssuesContaining(
  files: Record<string, string>,
  needles: string[],
): void {
  writeScript(files);
  const result = validateScriptDir(dir);
  expect(result.ok).toBe(false);
  const messages = result.issues.map((i) => `${i.file}:${i.path} ${i.message}`);
  for (const needle of needles) {
    expect(
      messages.some((m) => m.includes(needle)),
      `expected issue containing "${needle}" in:\n${messages.join("\n")}`,
    ).toBe(true);
  }
}

describe("semantic validation", () => {
  it("accepts the valid base script", () => {
    writeScript(validBase());
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects duplicate id across files", () => {
    const files = validBase();
    files["npcs/npc2.yaml"] = `
id: npc1
name: 重复
base_class: humanoid
description: 重复id
llm:
  personality: 测试
  knowledge_filter: true
`;
    expectIssuesContaining(files, ["duplicate id"]);
  });

  it("rejects unknown field (strict)", () => {
    const files = validBase();
    files["script.yaml"] = files["script.yaml"].replace("author: test", "author: test\nbogus: 1");
    expectIssuesContaining(files, ["bogus"]);
  });

  it("rejects wrong schema_version", () => {
    const files = validBase();
    files["script.yaml"] = files["script.yaml"].replace(
      'schema_version: "1.1"',
      'schema_version: "2.0"',
    );
    expectIssuesContaining(files, ["expected \"1.1\""]);
  });

  it("rejects invalid id format", () => {
    const files = validBase();
    files["origins/o1.yaml"] = files["origins/o1.yaml"].replace("id: o1", "id: O1");
    expectIssuesContaining(files, ["lowercase"]);
  });

  it("rejects actions → missing stat", () => {
    const files = validBase();
    files["actions.yaml"] = files["actions.yaml"].replace(
      "resolve: { type: stat_check, stat: strength, dc: 12 }",
      "resolve: { type: stat_check, stat: nonexistent, dc: 12 }",
    );
    expectIssuesContaining(files, ['stat "nonexistent" not declared']);
  });

  it("rejects actions → missing skill", () => {
    const files = validBase();
    files["actions.yaml"] = files["actions.yaml"].replace(
      "resolve: { type: skill_check, skill: persuasion, dc: 12 }",
      "resolve: { type: skill_check, skill: nope, dc: 12 }",
    );
    expectIssuesContaining(files, ['skill "nope" not declared']);
  });

  it("rejects plot → missing secret", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace("secrets: [s1]", "secrets: [ghost]");
    expectIssuesContaining(files, ['secret "ghost" not found']);
  });

  it("rejects plot → missing npc", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace("npcs: [npc1]", "npcs: [ghost]");
    expectIssuesContaining(files, ['npc "ghost" not found']);
  });

  it("rejects origin → missing location", () => {
    const files = validBase();
    files["origins/o1.yaml"] = files["origins/o1.yaml"].replace(
      "starting_location: tavern",
      "starting_location: nowhere",
    );
    expectIssuesContaining(files, ['location "nowhere" not found']);
  });

  it("rejects origin → missing item", () => {
    const files = validBase();
    files["origins/o1.yaml"] = files["origins/o1.yaml"].replace("items: [item1]", "items: [ghost]");
    expectIssuesContaining(files, ['item "ghost" not found']);
  });

  it("rejects npc → missing schedule", () => {
    const files = validBase();
    files["npcs/npc1.yaml"] = files["npcs/npc1.yaml"].replace("schedule: keeper", "schedule: ghost");
    expectIssuesContaining(files, ['schedule "ghost" not declared']);
  });

  it("rejects npc → missing home location", () => {
    const files = validBase();
    files["npcs/npc1.yaml"] = files["npcs/npc1.yaml"].replace("home: tavern", "home: ghost");
    expectIssuesContaining(files, ['location "ghost" not found']);
  });

  it("rejects npc → missing relation target", () => {
    const files = validBase();
    files["npcs/npc1.yaml"] = files["npcs/npc1.yaml"].replace(
      "relations: []",
      "relations:\n  - { target: ghost, value: 30, type: 旧识 }",
    );
    expectIssuesContaining(files, ['relation target "ghost" not found']);
  });

  it("rejects npc → missing stat override", () => {
    const files = validBase();
    files["npcs/npc1.yaml"] = files["npcs/npc1.yaml"].replace("stats: { hp: 80 }", "stats: { magic: 5 }");
    expectIssuesContaining(files, ['stat "magic" not declared']);
  });

  it("rejects location → missing connection", () => {
    const files = validBase();
    files["locations/tavern.yaml"] = files["locations/tavern.yaml"].replace(
      "connections: []",
      "connections:\n  - { to: ghost, distance: 1, travel_time: 5 }",
    );
    expectIssuesContaining(files, ['connection "ghost" not found']);
  });

  it("rejects faction → missing member npc", () => {
    const files = validBase();
    files["factions/f1.yaml"] = `
id: f1
name: 测试势力
description: 测试
members: [ghost]
relations: []
`;
    expectIssuesContaining(files, ['npc "ghost" not found']);
  });

  it("rejects event → missing location & missing event text", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
locations: [ghost]
narrative: { template: ghost }
weight: 1
cooldown: 1
repeatable: false
`;
    expectIssuesContaining(files, ['location "ghost" not found', 'event text template "ghost" not found']);
  });

  it("rejects task → missing giver npc", () => {
    const files = validBase();
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver: { pool: [ghost] }
rewards: []
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    expectIssuesContaining(files, ['npc "ghost" not found']);
  });

  it("rejects item effect → missing stat", () => {
    const files = validBase();
    files["items/item1.yaml"] = files["items/item1.yaml"].replace(
      "rarity: common",
      "effects_on_use:\n  - { kind: stat, direction: add, target: player, stat: ghost, value: 10 }\nrarity: common",
    );
    expectIssuesContaining(files, ['stat "ghost" not declared']);
  });

  it("rejects narrative examples → missing npc", () => {
    const files = validBase();
    files["narrative/examples/e1.yaml"] = `
npc_id: ghost
exchanges:
  - { player: 你好, npc: 你好 }
`;
    expectIssuesContaining(files, ['npc "ghost" not found']);
  });

  it("rejects event_texts → missing event", () => {
    const files = validBase();
    files["narrative/event_texts/e1.yaml"] = `
event_id: ghost
templates:
  - { tone: 严肃, text: 文本 }
`;
    expectIssuesContaining(files, ['event "ghost" not found']);
  });

  it("rejects worldgen pool → missing entity", () => {
    const files = validBase();
    files["worldgen.yaml"] = files["worldgen.yaml"].replace(
      "randomize:\n  - target: npc_stats\n    jitter: 0.1",
      "randomize:\n  - target: secret_holder\n    pool: [ghost]\n    distribution: uniform",
    );
    expectIssuesContaining(files, ['pool id "ghost" not found']);
  });

  it("rejects run soft_failure → missing location", () => {
    const files = validBase();
    files["run.yaml"] = files["run.yaml"].replace(
      "location: tavern",
      "location: ghost",
    );
    expectIssuesContaining(files, ['location "ghost" not found']);
  });

  it("rejects script id != directory name", () => {
    const files = validBase();
    files["script.yaml"] = files["script.yaml"].replace("id: testscript", "id: othername");
    expectIssuesContaining(files, ["must equal directory name"]);
  });

  it("rejects YAML alias (security)", () => {
    const files = validBase();
    files["world.yaml"] = files["world.yaml"].replace(
      "background: 测试世界背景",
      "background: &anchor 测试世界背景\nduplicate: *anchor",
    );
    expectIssuesContaining(files, ["aliases/anchors are forbidden"]);
  });

  // --- Newly covered edges from review: events effects full kinds ---
  it("rejects event effect → missing item", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
effects:
  - { kind: item, direction: add, target: player, item: ghost }
weight: 1
cooldown: 1
repeatable: false
`;
    expectIssuesContaining(files, ['item "ghost" not found']);
  });

  it("rejects event effect → missing faction", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
effects:
  - { kind: reputation, direction: add, target: player, faction: ghost, value: 5 }
weight: 1
cooldown: 1
repeatable: false
`;
    expectIssuesContaining(files, ['faction "ghost" not found']);
  });

  it("rejects event effect → missing location (teleport)", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
effects:
  - { kind: teleport, direction: set, target: player, location: ghost }
weight: 1
cooldown: 1
repeatable: false
`;
    expectIssuesContaining(files, ['location "ghost" not found']);
  });

  it("rejects event effect → missing status", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
effects:
  - { kind: status, direction: add, target: player, status: ghost }
weight: 1
cooldown: 1
repeatable: false
`;
    expectIssuesContaining(files, ['status "ghost" not declared in mechanics.yaml']);
  });

  it("rejects event effect → missing npc target", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
effects:
  - { kind: relation, direction: add, target: ghost, npc: npc1, value: 5 }
weight: 1
cooldown: 1
repeatable: false
`;
    expectIssuesContaining(files, ['target npc "ghost" not found']);
  });

  // --- Newly covered edges: tasks rewards full kinds ---
  it("rejects task reward → missing npc", () => {
    const files = validBase();
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver: { pool: [npc1] }
rewards:
  - { kind: relation, direction: add, target: player, npc: ghost, value: 5 }
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    expectIssuesContaining(files, ['npc "ghost" not found']);
  });

  it("rejects task reward → missing location", () => {
    const files = validBase();
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver: { pool: [npc1] }
rewards:
  - { kind: teleport, direction: set, target: player, location: ghost }
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    expectIssuesContaining(files, ['location "ghost" not found']);
  });

  it("rejects task reward → missing status", () => {
    const files = validBase();
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver: { pool: [npc1] }
rewards:
  - { kind: status, direction: add, target: player, status: ghost }
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    expectIssuesContaining(files, ['status "ghost" not declared in mechanics.yaml']);
  });

  it("rejects task reward → missing event", () => {
    const files = validBase();
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver: { pool: [npc1] }
rewards:
  - { kind: event, direction: set, target: player, event: ghost }
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    expectIssuesContaining(files, ['event "ghost" not found']);
  });

  // --- Newly covered: run unlocks[].grant → origins ---
  it("rejects run unlock grant → missing origin", () => {
    const files = validBase();
    files["run.yaml"] = files["run.yaml"].replace(
      "unlocks: []",
      "unlocks:\n  - { flag: returned, grant: [ghost] }",
    );
    expectIssuesContaining(files, ['origin "ghost" not found in origins/']);
  });

  // --- Newly covered: run soft_failure consequence.effects full kinds ---
  it("rejects run soft_failure consequence effect → missing status", () => {
    const files = validBase();
    files["run.yaml"] = files["run.yaml"].replace(
      "effects: []",
      "effects:\n        - { kind: status, direction: add, target: player, status: ghost }",
    );
    expectIssuesContaining(files, [
      'status "ghost" not declared in mechanics.yaml',
    ]);
  });

  it("rejects run soft_failure consequence effect → missing item", () => {
    const files = validBase();
    files["run.yaml"] = files["run.yaml"].replace(
      "effects: []",
      "effects:\n        - { kind: item, direction: add, target: player, item: ghost }",
    );
    expectIssuesContaining(files, ['item "ghost" not found']);
  });

  // --- Newly covered: illegal op in condition algebra ---
  it("rejects illegal condition op (bogus)", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace(
      "op: gte",
      "op: bogus",
    );
    writeScript(files);
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) =>
      i.path.includes("trigger.condition"),
    );
    expect(issue).toBeDefined();
    expect(issue!.file).toBe("plot.yaml");
  });

  // --- Newly covered: type mismatch (string in numeric field) ---
  it("rejects type mismatch (string dc in action resolve)", () => {
    const files = validBase();
    files["actions.yaml"] = files["actions.yaml"].replace(
      "dc: 12",
      'dc: "high"',
    );
    expectIssuesContaining(files, ["expected number, received string"]);
  });

  // --- Newly covered: line number attribution (lineForPath end-to-end) ---
  it("reports the correct line number for a schema violation", () => {
    const files = validBase();
    // script.yaml template starts with a newline; `tone: [悬疑]` is on line 7
    files["script.yaml"] = files["script.yaml"].replace(
      "tone: [悬疑]",
      "tone: []",
    );
    writeScript(files);
    const result = validateScriptDir(dir);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.path === "tone");
    expect(issue).toBeDefined();
    expect(issue!.line).toBe(7);
  });

  // --- R10: appendix C op×source matrix ---
  it("rejects stat condition with has op", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace(
      "- { source: relationship, key: npc1, op: gte, value: 60 }",
      "- { source: stat, key: strength, op: has }",
    );
    expectIssuesContaining(files, ['op "has" not allowed for source "stat"']);
  });

  it("rejects flag condition with numeric op", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace(
      "- { source: relationship, key: npc1, op: gte, value: 60 }",
      "- { source: flag, key: some-flag, op: eq, value: 1 }",
    );
    expectIssuesContaining(files, ['op "eq" not allowed for source "flag"']);
  });

  it("rejects location condition with has op", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace(
      "- { source: relationship, key: npc1, op: gte, value: 60 }",
      "- { source: location, key: current, op: has }",
    );
    expectIssuesContaining(files, ['op "has" not allowed for source "location"']);
  });

  it("rejects in op with non-array value", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace(
      "- { source: relationship, key: npc1, op: gte, value: 60 }",
      "- { source: location, key: current, op: in, value: tavern }",
    );
    expectIssuesContaining(files, ['op "in" requires an array value']);
  });

  it("rejects eq op with array value", () => {
    const files = validBase();
    files["plot.yaml"] = files["plot.yaml"].replace(
      "- { source: relationship, key: npc1, op: gte, value: 60 }",
      "- { source: location, key: current, op: eq, value: [tavern] }",
    );
    expectIssuesContaining(files, ['op "eq" does not accept an array value']);
  });

  it("rejects npc secret reveal logic with illegal op", () => {
    const files = validBase();
    files["npcs/npc1.yaml"] = files["npcs/npc1.yaml"].replace(
      "- { source: relationship, key: player, op: gte, value: 60 }",
      "- { source: inventory, key: pickaxe, op: has }",
    );
    expectIssuesContaining(files, ['op "has" not allowed for source "inventory"']);
  });

  it("rejects narrative hook condition with illegal op", () => {
    const files = validBase();
    files["narrative/opening.yaml"] = files["narrative/opening.yaml"].replace(
      "hooks: []",
      "hooks:\n  - { text: 测试钩子, condition: { source: stat, key: hp, op: has } }",
    );
    expectIssuesContaining(files, ['op "has" not allowed for source "stat"']);
  });

  // --- R10: reference edge additions ---
  it("rejects festival → missing event", () => {
    const files = validBase();
    files["time.yaml"] = files["time.yaml"].replace(
      "world_advances: true",
      'festivals:\n  - { id: festival-1, name: 测试节, date: "01-01", event: ghost }\nworld_advances: true',
    );
    expectIssuesContaining(files, ['event "ghost" not found']);
  });

  it("rejects schedule entry → missing location", () => {
    const files = validBase();
    files["time.yaml"] = files["time.yaml"].replace(
      "location: tavern",
      "location: ghost",
    );
    expectIssuesContaining(files, [
      "schedules[keeper].entries[0].location",
      'location "ghost" not found',
    ]);
  });

  it("rejects task conditions/giver.condition → missing refs", () => {
    const files = validBase();
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver:
  pool: [npc1]
  condition: { source: reputation, key: ghostfaction, op: gte, value: 10 }
conditions:
  all:
    - { source: location, key: current, op: eq, value: ghostloc }
    - { source: inventory, key: ghostitem, op: gte, value: 1 }
    - { source: relationship, key: ghostnpc, op: gte, value: 1 }
    - { source: stat, key: ghoststat, op: gte, value: 1 }
    - { source: skill, key: ghostskill, op: gte, value: 1 }
    - { source: need, key: ghostneed, op: gte, value: 1 }
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    expectIssuesContaining(files, [
      'npc "ghostnpc" not found',
      'faction "ghostfaction" not found',
      'location "ghostloc" not found',
      'stat "ghoststat" not declared',
      'skill "ghostskill" not declared',
      'need "ghostneed" not declared',
      'item "ghostitem" not found',
    ]);
  });

  it("rejects location connection condition → missing refs", () => {
    const files = validBase();
    files["locations/tavern.yaml"] = files["locations/tavern.yaml"].replace(
      "connections: []",
      "connections:\n  - to: tavern\n    distance: 0\n    travel_time: 0\n    condition:\n      all:\n        - { source: location, key: current, op: eq, value: ghostcond }\n        - { source: stat, key: ghoststat, op: gte, value: 1 }",
    );
    expectIssuesContaining(files, [
      'location "ghostcond" not found',
      'stat "ghoststat" not declared',
    ]);
  });

  it("rejects origin exclusive_to → missing location", () => {
    const files = validBase();
    files["origins/o1.yaml"] = files["origins/o1.yaml"].replace(
      "starting_currency: 30",
      "starting_currency: 30\nexclusive_to: ghost",
    );
    expectIssuesContaining(files, ['location "ghost" not found']);
  });

  it("rejects faction threshold effects → missing refs", () => {
    const files = validBase();
    files["factions/f1.yaml"] = `
id: f1
name: 测试势力
description: 测试
members: [npc1]
relations: []
reputation:
  thresholds:
    - value: 10
      label: 友好
      effects:
        - { kind: relation, direction: add, target: player, npc: ghostnpc, value: 5 }
        - { kind: status, direction: add, target: player, status: ghoststatus }
        - { kind: item, direction: add, target: player, item: ghostitem }
        - { kind: reputation, direction: add, target: player, faction: ghostfaction, value: 5 }
        - { kind: stat, direction: add, target: player, stat: ghoststat, value: 1 }
        - { kind: teleport, direction: set, target: player, location: ghostloc }
  decay: 0
`;
    expectIssuesContaining(files, [
      'npc "ghostnpc" not found',
      'status "ghoststatus" not declared in mechanics.yaml',
      'item "ghostitem" not found',
      'faction "ghostfaction" not found',
      'stat "ghoststat" not declared',
      'location "ghostloc" not found',
    ]);
  });

  it("rejects duplicate secret id across npcs", () => {
    const files = validBase();
    files["npcs/npc2.yaml"] = `
id: npc2
name: 测试NPC2
base_class: humanoid
description: 测试
secrets:
  - id: s1
    content: 重复秘密
    reveal:
      logic: { source: flag, key: returned, op: has }
llm:
  personality: 测试
  knowledge_filter: true
`;
    expectIssuesContaining(files, ['duplicate secret id "s1" across npcs']);
  });

  // --- R10: valid usage of new edges must not false-positive ---
  it("accepts valid usage of the new edges", () => {
    const files = validBase();
    files["events/e1.yaml"] = `
id: e1
name: 测试事件
type: crisis
tags: [danger]
trigger: director
weight: 1
cooldown: 1
repeatable: false
`;
    files["time.yaml"] = files["time.yaml"].replace(
      "world_advances: true",
      'festivals:\n  - { id: festival-1, name: 测试节, date: "01-01", event: e1 }\nworld_advances: true',
    );
    files["factions/f1.yaml"] = `
id: f1
name: 测试势力
description: 测试
members: [npc1]
relations: []
reputation:
  thresholds:
    - value: 10
      label: 友好
      effects:
        - { kind: item, direction: add, target: player, item: item1 }
  decay: 0
`;
    files["tasks/t1.yaml"] = `
id: t1
name: 测试任务
objective:
  type: gather
  target: { pool: [item1] }
  quantity: 1
giver:
  pool: [npc1]
  condition: { source: reputation, key: f1, op: gte, value: 10 }
conditions:
  all:
    - { source: location, key: current, op: in, value: [tavern] }
    - { source: inventory, key: item1, op: gte, value: 1 }
    - { source: flag, key: returned, op: has }
repeatable: false
narrative:
  offer: 给你
  complete: 完成
  fail: 失败
`;
    files["locations/tavern.yaml"] = files["locations/tavern.yaml"].replace(
      "connections: []",
      "connections:\n  - to: tavern\n    distance: 0\n    travel_time: 0\n    condition: { source: flag, key: returned, op: not_has }",
    );
    writeScript(files);
    const result = validateScriptDir(dir);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
