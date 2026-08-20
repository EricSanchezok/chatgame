import { describe, expect, it } from "vitest";
import {
  actionsSchema,
  directorSchema,
  eventSchema,
  eventTextSchema,
  exampleDialogueSchema,
  factionSchema,
  itemSchema,
  locationSchema,
  loreEntrySchema,
  mechanicsSchema,
  npcSchema,
  openingSchema,
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
} from "../index";

function expectValid(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown): void {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify((r as { error?: { issues?: unknown[] } }).error?.issues ?? null)).toBe(true);
}

function expectInvalid(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown): void {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
}

describe("script schema", () => {
  it("accepts a valid script", () => {
    expectValid(scriptSchema, {
      id: "emberfall",
      name: "灰烬镇",
      description: "边陲小镇",
      schema_version: "1.1",
      language: "zh",
      tone: ["悬疑"],
      author: "team",
    });
  });
  it("rejects unknown fields (strict)", () => {
    expectInvalid(scriptSchema, {
      id: "emberfall",
      name: "灰烬镇",
      description: "x",
      schema_version: "1.1",
      language: "zh",
      tone: ["悬疑"],
      author: "team",
      bogus: true,
    });
  });
  it("rejects wrong schema_version", () => {
    expectInvalid(scriptSchema, {
      id: "emberfall",
      name: "灰烬镇",
      description: "x",
      schema_version: "2.0",
      language: "zh",
      tone: ["悬疑"],
      author: "team",
    });
  });
  it("rejects invalid id format", () => {
    expectInvalid(scriptSchema, {
      id: "EmberFall",
      name: "灰烬镇",
      description: "x",
      schema_version: "1.1",
      language: "zh",
      tone: ["悬疑"],
      author: "team",
    });
  });
});

describe("world schema", () => {
  const valid = {
    background: "世界背景",
    rules: [{ id: "r1", text: "规则一", mechanism: "inventory" }],
    taboos: [{ id: "t1", text: "禁忌一", severity: "hard" }],
    glossary: [{ term: "灰烬", aliases: ["烬"], definition: "定义" }],
  };
  it("accepts a valid world", () => expectValid(worldSchema, valid));
  it("rejects empty rules", () => expectInvalid(worldSchema, { ...valid, rules: [] }));
  it("rejects unknown taboo severity", () =>
    expectInvalid(worldSchema, { ...valid, taboos: [{ id: "t1", text: "x", severity: "maybe" }] }));
  it("rejects unknown field", () => expectInvalid(worldSchema, { ...valid, extra: 1 }));
});

describe("time schema", () => {
  const valid = {
    unit: "hour",
    day_length_hours: 24,
    calendar: { months: [{ name: "一月", days: 31 }], weekdays: ["周一"] },
    seasons: [{ name: "春", start: "03-01", weather_table: [{ weather: "晴", weight: 5 }] }],
    festivals: [{ id: "fest1", name: "节日", date: "01-01" }],
    schedules: [{ id: "keeper", entries: [{ from: "08:00", to: "22:00", activity: "开店", location: "tavern" }] }],
    world_advances: true,
    advance_mode: "rule_based",
    advance_scope: ["schedules", "needs", "time_events"],
  };
  it("accepts a valid time", () => expectValid(timeSchema, valid));
  it("rejects bad unit", () => expectInvalid(timeSchema, { ...valid, unit: "day" }));
  it("rejects bad time format", () =>
    expectInvalid(timeSchema, { ...valid, schedules: [{ id: "keeper", entries: [{ from: "25:00", to: "22:00", activity: "开店" }] }] }));
  it("rejects bad advance_scope", () => expectInvalid(timeSchema, { ...valid, advance_scope: ["magic"] }));
});

describe("mechanics schema", () => {
  const valid = {
    stats: [{ name: "hp", min: 1, max: 20, initial: 10, description: "生命" }],
    skills: [{ name: "persuasion", min: 0, max: 20, initial: 0, description: "说服" }],
    needs: [{ name: "hunger", min: 0, max: 100, initial: 80, decay_per_day: 20, thresholds: [] }],
    status_effects: [{ id: "poison", name: "中毒", kind: "debuff", effects: [], stackable: false }],
    inventory: { capacity: 20, stacking: true },
    currency: { name: "金币", symbol: "g", initial: 50 },
    combat: { damage_types: ["physical"], defense_types: ["armor"], hp_stat: "hp", threat_gauge: { max: 100, on_full: "soft" } },
    progression: [{ source: "skill_check", target: "persuasion", amount: 1 }],
  };
  it("accepts a valid mechanics", () => expectValid(mechanicsSchema, valid));
  it("rejects stat without name", () => expectInvalid(mechanicsSchema, { ...valid, stats: [{ min: 1, max: 2, initial: 1 }] }));
  it("rejects unknown combat field", () =>
    expectInvalid(mechanicsSchema, { ...valid, combat: { ...valid.combat, magic: true } }));
});

describe("actions schema", () => {
  const valid = {
    actions: [
      { id: "talk", enabled: true, resolve: { type: "auto" }, llm_freedom: "narration" },
      {
        id: "attack",
        resolve: { type: "stat_check", stat: "strength", dc: 12 },
        effects: [{ kind: "stat", direction: "add", target: "npc", stat: "hp", value: -5 }],
        llm_freedom: "process",
      },
    ],
  };
  it("accepts valid actions", () => expectValid(actionsSchema, valid));
  // Custom action ids are now legal when the script ships a handler
  // (script engine extension); only malformed ids are rejected.
  it("accepts custom action id with handler", () =>
    expectValid(actionsSchema, { actions: [{ id: "forge", handler: "forge", resolve: { type: "auto" } }] }));
  it("rejects action without resolve or handler", () =>
    expectInvalid(actionsSchema, { actions: [{ id: "fly" }] }));
  it("rejects unknown resolve type", () =>
    expectInvalid(actionsSchema, { actions: [{ id: "talk", resolve: { type: "random" } }] }));
  it("rejects unknown llm_freedom", () =>
    expectInvalid(actionsSchema, { actions: [{ id: "talk", resolve: { type: "auto" }, llm_freedom: "free" }] }));
});

describe("plot schema", () => {
  const valid = {
    commitments: [
      {
        id: "c1",
        description: "秘密揭露",
        type: "secret_reveal",
        trigger: { condition: { all: [{ source: "relationship", key: "elara", op: "gte", value: 60 }] } },
        must_happen: true,
        deadline: { time: { day: 90 }, on_miss: { escalation_text: "浮出水面", effects: [] } },
        related: { secrets: ["s1"], npcs: ["elara"] },
      },
    ],
  };
  it("accepts a valid plot", () => expectValid(plotSchema, valid));
  it("rejects must_happen false", () => expectInvalid(plotSchema, { commitments: [{ ...valid.commitments[0], must_happen: false }] }));
  it("rejects empty trigger", () => expectInvalid(plotSchema, { commitments: [{ ...valid.commitments[0], trigger: {} }] }));
});

describe("director schema", () => {
  const valid = {
    tension: { variables: [{ name: "danger", source: "threat_gauge", min: 0, max: 100, initial: 10 }] },
    event_selection: { policy: "weighted_by_band", bands: [{ band: [0, 30], weight_multiplier: 0.8 }] },
    pacing: { crisis_density: 0.3, breather_min_interval: 2, difficulty_ramp: 0.05 },
    novelty: { seen_tracking: true, cooldown_default: 3 },
  };
  it("accepts a valid director", () => expectValid(directorSchema, valid));
  it("rejects wrong policy", () => expectInvalid(directorSchema, { ...valid, event_selection: { policy: "random", bands: [] } }));
  it("rejects seen_tracking false", () => expectInvalid(directorSchema, { ...valid, novelty: { seen_tracking: false, cooldown_default: 3 } }));
});

describe("worldgen schema", () => {
  const valid = {
    randomize: [{ target: "npc_stats", jitter: 0.1, distribution: "uniform" }],
    fixed: ["plot_commitments", "world_rules"],
    seed: { policy: "per_run" },
  };
  it("accepts a valid worldgen", () => expectValid(worldgenSchema, valid));
  it("rejects unknown target", () => expectInvalid(worldgenSchema, { ...valid, randomize: [{ target: "nuke" }] }));
  it("rejects seed policy not per_run", () => expectInvalid(worldgenSchema, { ...valid, seed: { policy: "fixed" } }));
});

describe("run schema", () => {
  const valid = {
    death_policy: {
      mode: "soft_failure",
      soft_failure: {
        gauge_ref: "threat_gauge",
        threshold: 100,
        consequence: { location: "infirmary", effects: [], narrative: "你醒来" },
      },
    },
    meta_progression: { keep: ["flags", "lore"], reset: ["stats"], unlocks: [{ flag: "returned", grant: ["origin2"] }] },
    memory: { tier_retention_days: { major: 0, minor: 90, trivial: 30 } },
    context_compaction: { policy: "summarize_archive", retention_tiers: ["major", "minor"] },
  };
  it("accepts a valid run", () => expectValid(runSchema, valid));
  it("rejects soft_failure mode without config", () => expectInvalid(runSchema, { ...valid, death_policy: { mode: "soft_failure" } }));
  it("rejects unknown death mode", () => expectInvalid(runSchema, { ...valid, death_policy: { mode: "respawn" } }));
  it("accepts hard_reset with config", () =>
    expectValid(runSchema, { ...valid, death_policy: { mode: "hard_reset", hard_reset: { world_reroll: "keep_world" } } }));
});

describe("safety schema", () => {
  const valid = {
    content_classes: ["violence", "romance", "horror", "profanity", "self_harm", "sexual", "drugs", "gambling", "politics", "religion", "crime"],
    allowed: {
      violence: "intense",
      romance: "moderate",
      horror: "intense",
      profanity: "mild",
      self_harm: "none",
      sexual: "none",
      drugs: "mild",
      gambling: "moderate",
      politics: "mild",
      religion: "mild",
      crime: "moderate",
    },
    forbidden: ["self_harm", "sexual"],
    age_rating: "16+",
  };
  it("accepts a valid safety", () => expectValid(safetySchema, valid));
  it("accepts free-text intensity", () => expectValid(safetySchema, { ...valid, allowed: { ...valid.allowed, violence: "极端" } }));
  it("accepts free-text content class", () => expectValid(safetySchema, { ...valid, forbidden: ["超自然"] }));
});

describe("origin schema", () => {
  const valid = {
    id: "miner",
    name: "矿工出身",
    description: "地下摸爬滚打",
    difficulty: "easy",
    stats: { strength: 14 },
    skills: {},
    items: ["pickaxe"],
    starting_location: "tavern",
    starting_currency: 30,
    starting_relations: [{ npc: "elara", value: 40, type: "老主顾", description: "常来查账" }],
    starting_knowledge: ["mine-collapsed"],
    exclusive_leads: ["secret-hint"],
    denied_actions: [],
  };
  it("accepts a valid origin", () => expectValid(originSchema, valid));
  it("accepts free-text semantic labels on starting relations", () =>
    expectValid(originSchema, { ...valid, starting_relations: [{ npc: "elara", value: 40, type: "青梅竹马", description: "从小玩到大" }] }));
  it("rejects relation value out of range", () =>
    expectInvalid(originSchema, { ...valid, starting_relations: [{ npc: "elara", value: 150 }] }));
  it("rejects unknown field", () => expectInvalid(originSchema, { ...valid, magic: 1 }));
});

describe("npc schema", () => {
  const valid = {
    id: "elara",
    name: "艾拉",
    base_class: "humanoid",
    description: "酒馆老板娘",
    traits: [{ name: "谨慎", description: "不轻信", effects: [] }],
    stats: { hp: 80 },
    skills: { persuasion: 10 },
    occupation: "tavern_keeper",
    schedule: "keeper",
    home: "tavern",
    items: [],
    relations: [{ target: "inspector", value: 30, type: "老相识", description: "同姓本家，走动不多" }],
    memory: { initial: [{ text: "丈夫死于矿难", importance: "major", tags: ["family"] }] },
    secrets: [{ id: "mine-secret", content: "另有隐情", reveal: { logic: { all: [{ source: "relationship", key: "player", op: "gte", value: 60 }] } } }],
    knowledge_flags: ["mine-secret-holder"],
    llm: { personality: "轻声细语", speech_patterns: ["用短句"], knowledge_filter: true },
  };
  it("accepts a valid npc", () => expectValid(npcSchema, valid));
  it("accepts free-text relation type and description", () =>
    expectValid(npcSchema, { ...valid, relations: [{ target: "inspector", value: 30, type: "青梅竹马", description: "从战火里一起活下来的兄弟" }] }));
  it("rejects knowledge_filter false", () => expectInvalid(npcSchema, { ...valid, llm: { ...valid.llm, knowledge_filter: false } }));
});

describe("location schema", () => {
  const valid = {
    id: "tavern",
    name: "酒馆",
    type: "indoor",
    description: "老酒馆",
    connections: [{ to: "square", distance: 1, travel_time: 5 }],
    ambient_events: ["gossip"],
    npcs_present: ["elara"],
    items: ["ale"],
    danger_level: 1,
  };
  it("accepts a valid location", () => expectValid(locationSchema, valid));
  it("accepts free-text location type", () => expectValid(locationSchema, { ...valid, type: "地下矿道" }));
  it("rejects danger_level out of range", () => expectInvalid(locationSchema, { ...valid, danger_level: 11 }));
});

describe("item schema", () => {
  const valid = {
    id: "healing-potion",
    name: "治疗药水",
    type: "consumable",
    description: "恢复生命",
    properties: { stackable: true },
    effects_on_use: [{ kind: "stat", direction: "add", target: "player", stat: "hp", value: 20 }],
    rarity: "common",
    value: 10,
  };
  it("accepts a valid item", () => expectValid(itemSchema, valid));
  it("accepts free-text rarity", () => expectValid(itemSchema, { ...valid, rarity: "遗物" }));
  it("rejects negative value", () => expectInvalid(itemSchema, { ...valid, value: -5 }));
});

describe("faction schema", () => {
  const valid = {
    id: "miners-guild",
    name: "矿工工会",
    description: "老工会",
    goals: ["查明真相"],
    members: ["old-miner"],
    relations: [{ target: "town-hall", value: -30 }],
    reputation: { thresholds: [{ value: 50, label: "信任", effects: [] }], decay: 1 },
  };
  it("accepts a valid faction", () => expectValid(factionSchema, valid));
  it("rejects unknown relation fields (strict)", () =>
    expectInvalid(factionSchema, { ...valid, relations: [{ target: "town-hall", value: 0, stance: "wary" }] }));
});

describe("event schema", () => {
  const valid = {
    id: "mine-collapse",
    name: "矿井塌方",
    type: "crisis",
    tags: ["danger"],
    trigger: "director",
    conditions: { all: [{ source: "fact", key: "mine-secret", op: "not_has" }] },
    effects: [{ kind: "flag", direction: "set", target: "player", flag: "witnessed" }],
    narrative: { template: "mine-collapse" },
    weight: 2,
    cooldown: 5,
    repeatable: false,
    participants: ["old-miner"],
    locations: ["mine-entrance"],
  };
  it("accepts a valid event", () => expectValid(eventSchema, valid));
  it("rejects unknown trigger", () => expectInvalid(eventSchema, { ...valid, trigger: "manual" }));
});

describe("task schema", () => {
  const valid = {
    id: "gather-herbs",
    name: "采集药草",
    objective: { type: "gather", target: { items: ["herb"] }, quantity: 3 },
    giver: { pool: ["herbalist"] },
    rewards: [{ kind: "currency", direction: "add", target: "player", value: 15 }],
    repeatable: true,
    cooldown: 2,
    time_limit: { days: 3 },
    narrative: { offer: "给你清单", complete: "完成", fail: "失败" },
  };
  it("accepts a valid task", () => expectValid(taskSchema, valid));
  it("accepts an explicit investigate marker target", () => expectValid(taskSchema, {
    ...valid,
    objective: { type: "investigate", target: { marker: { source: "fact", key: "evidence-found" } }, quantity: 1 },
  }));
  it("rejects the ambiguous investigate subject target", () => expectInvalid(taskSchema, {
    ...valid,
    objective: { type: "investigate", target: { subject: "mine" }, quantity: 1 },
  }));
  it("rejects unknown objective type", () => expectInvalid(taskSchema, { ...valid, objective: { type: "fetch", target: { pool: [] } } }));
  it("rejects empty giver pool", () => expectInvalid(taskSchema, { ...valid, giver: { pool: [] } }));
});

describe("narrative schemas", () => {
  it("opening accepts valid", () =>
    expectValid(openingSchema, { scene: "清晨", first_lines: ["艾拉抬头看你"], hooks: [{ text: "熟客", condition: { all: [{ source: "flag", key: "returned", op: "has" }] } }] }));
  it("opening rejects empty scene", () => expectInvalid(openingSchema, { scene: "" }));
  it("style accepts valid", () =>
    expectValid(styleSchema, { voice: "第三人称有限", tense: "现在时", perspective: "主角", density: "normal", sentence_style: ["短句"], forbidden_words: ["突然"] }));
  it("style rejects unknown density", () => expectInvalid(styleSchema, { voice: "v", tense: "t", perspective: "p", density: "huge" }));
  it("lore accepts valid", () =>
    expectValid(loreEntrySchema, { id: "ash-lore", keywords: ["灰烬"], inject_when: "on_keyword", content: "灰烬是矿渣" }));
  it("lore rejects unknown inject_when", () =>
    expectInvalid(loreEntrySchema, { id: "ash-lore", keywords: [], inject_when: "sometimes", content: "x" }));
  it("examples accepts valid", () =>
    expectValid(exampleDialogueSchema, { npc_id: "elara", exchanges: [{ player: "你好", npc: "孩子，来点什么？" }] }));
  it("examples rejects empty exchanges", () => expectInvalid(exampleDialogueSchema, { npc_id: "elara", exchanges: [] }));
  it("event_text accepts valid", () =>
    expectValid(eventTextSchema, { event_id: "mine-collapse", templates: [{ tone: "严肃", text: "矿井深处传来轰鸣", slot_vars: ["npc"] }] }));
  it("event_text rejects empty templates", () => expectInvalid(eventTextSchema, { event_id: "mine-collapse", templates: [] }));
});
