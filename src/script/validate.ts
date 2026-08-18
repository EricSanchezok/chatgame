// Semantic validation for script directories:
// module zod validation + cross-file reference integrity (appendix E of the spec),
// condition op×source compatibility (appendix C), id uniqueness,
// schema_version strict match, and ID naming rules.
// Every issue carries file / field path / line number.
import path from "node:path";
import { z } from "zod";
import { loadYamlFile, loadYamlFilesFromDir, lineForPath, type LoadedYamlFile } from "./loader";
import {
  actionsSchema,
  directorSchema,
  eventSchema,
  factionSchema,
  itemSchema,
  locationSchema,
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
  loreEntrySchema,
  exampleDialogueSchema,
  eventTextSchema,
  builtinActionIdSchema,
  type Condition,
  type Effect,
} from "./schemas";

export interface ValidationIssue {
  file: string;
  line?: number;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  scriptId: string;
}

/** Parsed module data with its source file. */
interface ParsedModule<T> {
  file: LoadedYamlFile;
  data: T;
}

const ROOT_MODULES: Array<{ name: string; schema: z.ZodType; required: boolean }> = [
  { name: "script", schema: scriptSchema, required: true },
  { name: "world", schema: worldSchema, required: true },
  { name: "time", schema: timeSchema, required: true },
  { name: "mechanics", schema: mechanicsSchema, required: true },
  { name: "actions", schema: actionsSchema, required: true },
  { name: "plot", schema: plotSchema, required: true },
  { name: "director", schema: directorSchema, required: true },
  { name: "worldgen", schema: worldgenSchema, required: true },
  { name: "run", schema: runSchema, required: true },
  { name: "safety", schema: safetySchema, required: true },
];

/** Collects all id-like references from a condition tree. */
export function collectConditionRefs(
  condition: Condition | undefined,
  refs: { stat: Set<string>; skill: Set<string>; need: Set<string>; npc: Set<string>; faction: Set<string>; location: Set<string>; item: Set<string>; flag: Set<string>; fact: Set<string> },
): void {
  if (!condition) return;
  if ("all" in condition) {
    for (const c of condition.all) collectConditionRefs(c, refs);
    return;
  }
  if ("any" in condition) {
    for (const c of condition.any) collectConditionRefs(c, refs);
    return;
  }
  if ("not" in condition) {
    collectConditionRefs(condition.not, refs);
    return;
  }
  // leaf
  const leaf = condition as {
    source: string;
    key?: string;
    target?: string;
    op: string;
    value?: unknown;
  };
  switch (leaf.source) {
    case "stat":
      if (leaf.key) refs.stat.add(leaf.key);
      break;
    case "skill":
      if (leaf.key) refs.skill.add(leaf.key);
      break;
    case "need":
      if (leaf.key) refs.need.add(leaf.key);
      break;
    case "relationship":
      if (leaf.key && leaf.key !== "player") refs.npc.add(leaf.key);
      if (leaf.target && leaf.target !== "player") refs.npc.add(leaf.target);
      break;
    case "reputation":
      if (leaf.key) refs.faction.add(leaf.key);
      if (leaf.target && leaf.target !== "player") refs.faction.add(leaf.target);
      break;
    case "location":
      if (typeof leaf.value === "string") refs.location.add(leaf.value);
      if (leaf.key && leaf.key !== "current") refs.location.add(leaf.key);
      break;
    case "inventory":
      if (leaf.key) refs.item.add(leaf.key);
      break;
    case "flag":
      if (leaf.key) refs.flag.add(leaf.key);
      break;
    case "fact":
      if (leaf.key) refs.fact.add(leaf.key);
      break;
  }
}

export interface CollectedEffectRefs {
  stat: Set<string>;
  skill: Set<string>;
  need: Set<string>;
  item: Set<string>;
  npc: Set<string>;
  faction: Set<string>;
  location: Set<string>;
  status: Set<string>;
  secret: Set<string>;
  event: Set<string>;
  targetNpc: Set<string>;
  targetFaction: Set<string>;
}

/** Collects all id-like references from an effect list. */
export function collectEffectRefs(effects: Effect[] | undefined): CollectedEffectRefs {
  const refs: CollectedEffectRefs = {
    stat: new Set(),
    skill: new Set(),
    need: new Set(),
    item: new Set(),
    npc: new Set(),
    faction: new Set(),
    location: new Set(),
    status: new Set(),
    secret: new Set(),
    event: new Set(),
    targetNpc: new Set(),
    targetFaction: new Set(),
  };
  if (!effects) return refs;
  for (const e of effects) {
    switch (e.kind) {
      case "stat":
        refs.stat.add(e.stat);
        break;
      case "skill":
        refs.skill.add(e.skill);
        break;
      case "need":
        refs.need.add(e.need);
        break;
      case "item":
        refs.item.add(e.item);
        break;
      case "relation":
        refs.npc.add(e.npc);
        break;
      case "reputation":
        refs.faction.add(e.faction);
        break;
      case "teleport":
        refs.location.add(e.location);
        break;
      case "status":
        refs.status.add(e.status);
        break;
      case "secret":
        refs.secret.add(e.secret);
        break;
      case "event":
        refs.event.add(e.event);
        break;
    }
    if (e.target && e.target !== "player") {
      if (e.kind === "relation" || e.kind === "reputation") {
        refs.targetFaction.add(e.target);
        refs.targetNpc.add(e.target);
      } else {
        refs.targetNpc.add(e.target);
      }
    }
  }
  return refs;
}

/** Condition ops allowed per source class (appendix C op×source matrix). */
const CONDITION_OPS_BY_SOURCE: Record<string, readonly string[]> = {
  stat: ["gte", "lte", "gt", "lt", "eq", "neq"],
  skill: ["gte", "lte", "gt", "lt", "eq", "neq"],
  need: ["gte", "lte", "gt", "lt", "eq", "neq"],
  relationship: ["gte", "lte", "gt", "lt", "eq", "neq"],
  reputation: ["gte", "lte", "gt", "lt", "eq", "neq"],
  time: ["gte", "lte", "gt", "lt", "eq", "neq"],
  inventory: ["gte", "lte", "gt", "lt", "eq", "neq"],
  currency: ["gte", "lte", "gt", "lt", "eq", "neq"],
  flag: ["has", "not_has"],
  fact: ["has", "not_has"],
  location: ["eq", "neq", "in", "not_in"],
};

interface ConditionRefs {
  stat: Set<string>;
  skill: Set<string>;
  need: Set<string>;
  npc: Set<string>;
  faction: Set<string>;
  location: Set<string>;
  item: Set<string>;
  flag: Set<string>;
  fact: Set<string>;
}

function newConditionRefs(): ConditionRefs {
  return {
    stat: new Set(),
    skill: new Set(),
    need: new Set(),
    npc: new Set(),
    faction: new Set(),
    location: new Set(),
    item: new Set(),
    flag: new Set(),
    fact: new Set(),
  };
}

/**
 * Appendix C op×source walk: every leaf must use an op allowed for its source;
 * `in`/`not_in` values must be arrays, `eq`/`neq` values must not be arrays.
 */
function checkConditionSemantics(
  file: string,
  basePath: string,
  condition: Condition | undefined,
  add: (file: string, line: number | undefined, path: string, message: string) => void,
): void {
  if (!condition) return;
  if ("all" in condition) {
    condition.all.forEach((c, i) => checkConditionSemantics(file, `${basePath}.all[${i}]`, c, add));
    return;
  }
  if ("any" in condition) {
    condition.any.forEach((c, i) => checkConditionSemantics(file, `${basePath}.any[${i}]`, c, add));
    return;
  }
  if ("not" in condition) {
    checkConditionSemantics(file, `${basePath}.not`, condition.not, add);
    return;
  }
  const { source, op, value } = condition;
  const allowed = CONDITION_OPS_BY_SOURCE[source];
  if (allowed && !allowed.includes(op)) {
    add(file, undefined, `${basePath}.op`, `op "${op}" not allowed for source "${source}" (allowed: ${allowed.join("/")})`);
  }
  if ((op === "in" || op === "not_in") && !Array.isArray(value)) {
    add(file, undefined, `${basePath}.value`, `op "${op}" requires an array value`);
  }
  if ((op === "eq" || op === "neq") && Array.isArray(value)) {
    add(file, undefined, `${basePath}.value`, `op "${op}" does not accept an array value`);
  }
}
/** Structural schema validation of one loaded file; pushes zod issues into `issues`. */
function validateModule<T>(
  file: LoadedYamlFile,
  schema: z.ZodType<T>,
  issues: ValidationIssue[],
): T | undefined {
  const data = file.doc.toJS();
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const p = issue.path.join(".");
    const line = lineForPath(file, issue.path as Array<string | number>);
    issues.push({
      file: file.relPath,
      line,
      path: p || "(root)",
      message: issue.message,
    });
  }
  return undefined;
}

interface EntityPools {
  npcIds: Set<string>;
  locationIds: Set<string>;
  itemIds: Set<string>;
  factionIds: Set<string>;
  eventIds: Set<string>;
  taskIds: Set<string>;
  secretIds: Set<string>;
  scheduleIds: Set<string>;
  loreIds: Set<string>;
  exampleNpcIds: Set<string>;
  eventTextIds: Set<string>;
  originIds: Set<string>;
  statNames: Set<string>;
  skillNames: Set<string>;
  needNames: Set<string>;
  statusEffectIds: Set<string>;
  builtinActions: Set<string>;
}

function buildBuiltinActions(): Set<string> {
  return new Set(builtinActionIdSchema.options);
}

/** Cross-file reference integrity checks. Returns issues. */
function checkReferences(
  modules: Record<string, ParsedModule<unknown>>,
  arrays: {
    origins: ParsedModule<z.infer<typeof originSchema>>[];
    npcs: ParsedModule<z.infer<typeof npcSchema>>[];
    locations: ParsedModule<z.infer<typeof locationSchema>>[];
    items: ParsedModule<z.infer<typeof itemSchema>>[];
    factions: ParsedModule<z.infer<typeof factionSchema>>[];
    events: ParsedModule<z.infer<typeof eventSchema>>[];
    tasks: ParsedModule<z.infer<typeof taskSchema>>[];
    lore: ParsedModule<z.infer<typeof loreEntrySchema>>[];
    examples: ParsedModule<z.infer<typeof exampleDialogueSchema>>[];
    eventTexts: ParsedModule<z.infer<typeof eventTextSchema>>[];
  },
  issues: ValidationIssue[],
): void {
  const pools: EntityPools = {
    npcIds: new Set(),
    locationIds: new Set(),
    itemIds: new Set(),
    factionIds: new Set(),
    eventIds: new Set(),
    taskIds: new Set(),
    secretIds: new Set(),
    scheduleIds: new Set(),
    loreIds: new Set(),
    exampleNpcIds: new Set(),
    eventTextIds: new Set(),
    originIds: new Set(),
    statNames: new Set(),
    skillNames: new Set(),
    needNames: new Set(),
    statusEffectIds: new Set(),
    builtinActions: buildBuiltinActions(),
  };

  const mechanics = modules["mechanics"]?.data as z.infer<typeof mechanicsSchema> | undefined;
  const time = modules["time"]?.data as z.infer<typeof timeSchema> | undefined;
  const run = modules["run"]?.data as z.infer<typeof runSchema> | undefined;
  const worldgen = modules["worldgen"]?.data as z.infer<typeof worldgenSchema> | undefined;
  const director = modules["director"]?.data as z.infer<typeof directorSchema> | undefined;
  const actions = modules["actions"]?.data as z.infer<typeof actionsSchema> | undefined;
  const plot = modules["plot"]?.data as z.infer<typeof plotSchema> | undefined;
  const openingModule = modules["opening"];
  const opening = openingModule?.data as z.infer<typeof openingSchema> | undefined;

  // --- Build pools ---
  for (const s of mechanics?.stats ?? []) pools.statNames.add(s.name);
  for (const s of mechanics?.skills ?? []) pools.skillNames.add(s.name);
  for (const s of mechanics?.needs ?? []) pools.needNames.add(s.name);
  for (const s of mechanics?.status_effects ?? []) pools.statusEffectIds.add(s.id);
  for (const s of time?.schedules ?? []) pools.scheduleIds.add(s.id);
  for (const m of arrays.origins) pools.originIds.add(m.data.id);
  for (const m of arrays.npcs) {
    pools.npcIds.add(m.data.id);
    for (const secret of m.data.secrets) pools.secretIds.add(secret.id);
  }
  for (const m of arrays.locations) pools.locationIds.add(m.data.id);
  for (const m of arrays.items) pools.itemIds.add(m.data.id);
  for (const m of arrays.factions) pools.factionIds.add(m.data.id);
  for (const m of arrays.events) pools.eventIds.add(m.data.id);
  for (const m of arrays.tasks) pools.taskIds.add(m.data.id);
  for (const m of arrays.lore) pools.loreIds.add(m.data.id);
  for (const m of arrays.examples) pools.exampleNpcIds.add(m.data.npc_id);
  for (const m of arrays.eventTexts) pools.eventTextIds.add(m.data.event_id);

  const add = (file: string, line: number | undefined, path: string, message: string) =>
    issues.push({ file, line, path, message });

  // --- Unique id check across entity pools (global uniqueness) ---
  const allEntityIds = [
    ...arrays.npcs.map((m) => m.data.id),
    ...arrays.locations.map((m) => m.data.id),
    ...arrays.items.map((m) => m.data.id),
    ...arrays.factions.map((m) => m.data.id),
    ...arrays.events.map((m) => m.data.id),
    ...arrays.tasks.map((m) => m.data.id),
    ...arrays.lore.map((m) => m.data.id),
    ...(time?.schedules ?? []).map((s) => s.id),
  ];
  const seen = new Map<string, string>();
  for (const id of allEntityIds) {
    if (seen.has(id)) {
      add("(global)", undefined, id, `duplicate id "${id}" across files (first declared in ${seen.get(id)})`);
    } else {
      seen.set(id, "declared");
    }
  }

  // --- time → events (festivals) / locations (schedule entries) ---
  if (time) {
    for (const f of time.festivals ?? []) {
      if (f.event && !pools.eventIds.has(f.event)) {
        add("time.yaml", undefined, `festivals[${f.id}].event`, `event "${f.event}" not found`);
      }
    }
    for (const s of time.schedules ?? []) {
      for (const [i, entry] of s.entries.entries()) {
        if (entry.location && !pools.locationIds.has(entry.location)) {
          add("time.yaml", undefined, `schedules[${s.id}].entries[${i}].location`, `location "${entry.location}" not found`);
        }
      }
    }
  }

  // --- mechanics → stats / run cross-check ---
  if (mechanics) {
    const hp = mechanics.combat.hp_stat;
    if (!pools.statNames.has(hp)) {
      add("mechanics.yaml", undefined, "combat.hp_stat", `hp_stat "${hp}" is not a declared stat`);
    }
    if (mechanics.combat.threat_gauge.on_full) {
      const onFull = mechanics.combat.threat_gauge.on_full;
      const runRef = run?.death_policy.soft_failure?.gauge_ref;
      if (run?.death_policy.mode === "soft_failure" && !runRef) {
        add("mechanics.yaml", undefined, "combat.threat_gauge.on_full", `on_full "${onFull}" references a soft-failure strategy, but run.yaml soft_failure has no gauge_ref`);
      }
    }
  }

  // --- run → locations / gauge / unlocks cross-check ---
  if (run) {
    if (run.death_policy.mode === "soft_failure" && run.death_policy.soft_failure) {
      const loc = run.death_policy.soft_failure.consequence.location;
      if (!pools.locationIds.has(loc)) {
        add("run.yaml", undefined, "death_policy.soft_failure.consequence.location", `location "${loc}" not found`);
      }
      const gaugeRef = run.death_policy.soft_failure.gauge_ref;
      if (!mechanics?.combat.threat_gauge) {
        add("run.yaml", undefined, "death_policy.soft_failure.gauge_ref", `gauge_ref "${gaugeRef}" requires mechanics.yaml combat.threat_gauge`);
      } else if (gaugeRef && gaugeRef !== "threat_gauge") {
        add("run.yaml", undefined, "death_policy.soft_failure.gauge_ref", `gauge_ref "${gaugeRef}" does not match the declared threat_gauge`);
      }
      const erefs = collectEffectRefs(run.death_policy.soft_failure.consequence.effects);
      for (const id of erefs.stat) if (!pools.statNames.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `stat "${id}" not declared`);
      for (const id of erefs.skill) if (!pools.skillNames.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `skill "${id}" not declared in mechanics.yaml`);
      for (const id of erefs.need) if (!pools.needNames.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `need "${id}" not declared in mechanics.yaml`);
      for (const id of erefs.item) if (!pools.itemIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `item "${id}" not found`);
      for (const id of erefs.faction) if (!pools.factionIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `faction "${id}" not found`);
      for (const id of erefs.npc) if (!pools.npcIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `npc "${id}" not found`);
      for (const id of erefs.location) if (!pools.locationIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `location "${id}" not found`);
      for (const id of erefs.status) if (!pools.statusEffectIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `status "${id}" not declared in mechanics.yaml`);
      for (const id of erefs.event) if (!pools.eventIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `event "${id}" not found`);
      for (const id of erefs.secret) if (!pools.secretIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `secret "${id}" not found`);
      for (const id of erefs.targetNpc) if (!pools.npcIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `target npc "${id}" not found`);
      for (const id of erefs.targetFaction) if (!pools.factionIds.has(id)) add("run.yaml", undefined, "death_policy.soft_failure.consequence.effects", `target faction "${id}" not found`);
    }
    for (const u of run.meta_progression.unlocks) {
      for (const id of u.grant) {
        if (!pools.originIds.has(id)) {
          add("run.yaml", undefined, `meta_progression.unlocks[${u.flag}].grant`, `origin "${id}" not found in origins/`);
        }
      }
    }
  }

  // --- director → tension source ---
  if (director) {
    for (const v of director.tension.variables) {
      const ok =
        v.source === "threat_gauge" ||
        run?.death_policy.soft_failure?.gauge_ref === v.source;
      if (!ok) {
        add("director.yaml", undefined, `tension.variables[${v.name}].source`, `tension source "${v.source}" must resolve to a declared gauge (threat_gauge or run.yaml gauge_ref)`);
      }
    }
  }

  // --- worldgen → pools ---
  if (worldgen) {
    for (const r of worldgen.randomize) {
      if (!r.pool || r.pool.length === 0) continue;
      const poolSet = new Set(r.pool);
      let allowed: Set<string>;
      switch (r.target) {
        case "secret_holder":
        case "npc_placement":
        case "npc_stats":
          allowed = pools.npcIds;
          break;
        case "faction_stance":
          allowed = pools.factionIds;
          break;
        case "item_placement":
          allowed = pools.itemIds;
          break;
        case "starting_event":
          allowed = pools.eventIds;
          break;
        default:
          allowed = new Set();
      }
      for (const id of poolSet) {
        if (!allowed.has(id)) {
          add("worldgen.yaml", undefined, `randomize[${r.target}].pool`, `pool id "${id}" not found for target ${r.target}`);
        }
      }
    }
  }

  // --- actions → stats/skills/needs/items ---
  if (actions) {
    for (const a of actions.actions) {
      const base = `actions[${a.id}]`;
      if (a.resolve.type === "stat_check" && !pools.statNames.has(a.resolve.stat)) {
        add("actions.yaml", undefined, `${base}.resolve.stat`, `stat "${a.resolve.stat}" not declared in mechanics.yaml`);
      }
      if (a.resolve.type === "skill_check" && !pools.skillNames.has(a.resolve.skill)) {
        add("actions.yaml", undefined, `${base}.resolve.skill`, `skill "${a.resolve.skill}" not declared in mechanics.yaml`);
      }
      if (a.resolve.type === "opposed_check" && !pools.statNames.has(a.resolve.stat)) {
        add("actions.yaml", undefined, `${base}.resolve.stat`, `stat "${a.resolve.stat}" not declared in mechanics.yaml`);
      }
      if (a.resolve.type === "opposed_check" && !pools.statNames.has(a.resolve.npc_stat)) {
        add("actions.yaml", undefined, `${base}.resolve.npc_stat`, `npc_stat "${a.resolve.npc_stat}" not declared in mechanics.yaml`);
      }
      for (const c of a.costs?.items ?? []) {
        if (!pools.itemIds.has(c.item)) {
          add("actions.yaml", undefined, `${base}.costs.items`, `item "${c.item}" not found`);
        }
      }
      const refs = { stat: new Set<string>(), skill: new Set<string>(), need: new Set<string>(), npc: new Set<string>(), faction: new Set<string>(), location: new Set<string>(), item: new Set<string>(), flag: new Set<string>(), fact: new Set<string>() };
      collectConditionRefs(a.conditions, refs);
      for (const id of refs.stat) if (!pools.statNames.has(id)) add("actions.yaml", undefined, `${base}.conditions`, `stat "${id}" not declared`);
      for (const id of refs.skill) if (!pools.skillNames.has(id)) add("actions.yaml", undefined, `${base}.conditions`, `skill "${id}" not declared`);
      for (const id of refs.need) if (!pools.needNames.has(id)) add("actions.yaml", undefined, `${base}.conditions`, `need "${id}" not declared`);
      checkConditionSemantics("actions.yaml", `${base}.conditions`, a.conditions, add);
      const erefs = collectEffectRefs(a.effects);
      for (const id of erefs.stat) if (!pools.statNames.has(id)) add("actions.yaml", undefined, `${base}.effects`, `stat "${id}" not declared`);
      for (const id of erefs.item) if (!pools.itemIds.has(id)) add("actions.yaml", undefined, `${base}.effects`, `item "${id}" not found`);
      for (const id of erefs.npc) if (!pools.npcIds.has(id)) add("actions.yaml", undefined, `${base}.effects`, `npc "${id}" not found`);
      for (const id of erefs.targetNpc) if (!pools.npcIds.has(id)) add("actions.yaml", undefined, `${base}.effects`, `target npc "${id}" not found`);
      for (const id of erefs.status) if (!pools.statusEffectIds.has(id)) add("actions.yaml", undefined, `${base}.effects`, `status "${id}" not declared in mechanics.yaml`);
    }
  }

  // --- plot → secrets/npcs/events/locations ---
  if (plot) {
    for (const c of plot.commitments) {
      const base = `commitments[${c.id}]`;
      for (const id of c.related?.secrets ?? []) if (!pools.secretIds.has(id)) add("plot.yaml", undefined, `${base}.related.secrets`, `secret "${id}" not found on any NPC`);
      for (const id of c.related?.npcs ?? []) if (!pools.npcIds.has(id)) add("plot.yaml", undefined, `${base}.related.npcs`, `npc "${id}" not found`);
      for (const id of c.related?.events ?? []) if (!pools.eventIds.has(id)) add("plot.yaml", undefined, `${base}.related.events`, `event "${id}" not found`);
      for (const id of c.related?.locations ?? []) if (!pools.locationIds.has(id)) add("plot.yaml", undefined, `${base}.related.locations`, `location "${id}" not found`);
      const refs = { stat: new Set<string>(), skill: new Set<string>(), need: new Set<string>(), npc: new Set<string>(), faction: new Set<string>(), location: new Set<string>(), item: new Set<string>(), flag: new Set<string>(), fact: new Set<string>() };
      collectConditionRefs(c.trigger.condition, refs);
      collectConditionRefs(c.deadline?.condition, refs);
      for (const id of refs.npc) if (!pools.npcIds.has(id)) add("plot.yaml", undefined, `${base}.trigger`, `npc "${id}" not found`);
      for (const id of refs.faction) if (!pools.factionIds.has(id)) add("plot.yaml", undefined, `${base}.trigger`, `faction "${id}" not found`);
      for (const id of refs.location) if (!pools.locationIds.has(id)) add("plot.yaml", undefined, `${base}.trigger`, `location "${id}" not found`);
      checkConditionSemantics("plot.yaml", `${base}.trigger.condition`, c.trigger.condition, add);
      checkConditionSemantics("plot.yaml", `${base}.deadline.condition`, c.deadline?.condition, add);
    }
  }

  // --- narrative opening → hook condition semantics ---
  if (opening && openingModule) {
    for (const [i, h] of opening.hooks.entries()) {
      checkConditionSemantics(openingModule.file.relPath, `hooks[${i}].condition`, h.condition, add);
    }
  }

  // --- events → locations/npcs/events/event_texts + conditions/effects ---
  for (const m of arrays.events) {
    const e = m.data;
    const base = `events[${e.id}]`;
    for (const id of e.locations) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.locations`, `location "${id}" not found`);
    for (const id of e.participants) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.participants`, `npc "${id}" not found`);
    for (const id of e.exclusivity?.mutually_exclusive ?? []) if (!pools.eventIds.has(id)) add(m.file.relPath, undefined, `${base}.exclusivity.mutually_exclusive`, `event "${id}" not found`);
    if (e.narrative?.template && !pools.eventTextIds.has(e.narrative.template)) {
      add(m.file.relPath, undefined, `${base}.narrative.template`, `event text template "${e.narrative.template}" not found in narrative/event_texts/`);
    }
    const refs = { stat: new Set<string>(), skill: new Set<string>(), need: new Set<string>(), npc: new Set<string>(), faction: new Set<string>(), location: new Set<string>(), item: new Set<string>(), flag: new Set<string>(), fact: new Set<string>() };
    collectConditionRefs(e.conditions, refs);
    for (const id of refs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `npc "${id}" not found`);
    for (const id of refs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `location "${id}" not found`);
    checkConditionSemantics(m.file.relPath, `${base}.conditions`, e.conditions, add);
    const erefs = collectEffectRefs(e.effects);
    for (const id of erefs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `stat "${id}" not declared`);
    for (const id of erefs.skill) if (!pools.skillNames.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `skill "${id}" not declared in mechanics.yaml`);
    for (const id of erefs.need) if (!pools.needNames.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `need "${id}" not declared in mechanics.yaml`);
    for (const id of erefs.item) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `item "${id}" not found`);
    for (const id of erefs.faction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `faction "${id}" not found`);
    for (const id of erefs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `npc "${id}" not found`);
    for (const id of erefs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `location "${id}" not found`);
    for (const id of erefs.status) if (!pools.statusEffectIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `status "${id}" not declared in mechanics.yaml`);
    for (const id of erefs.targetNpc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `target npc "${id}" not found`);
    for (const id of erefs.targetFaction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `target faction "${id}" not found`);
    for (const id of erefs.event) if (!pools.eventIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `event "${id}" not found`);
    for (const id of erefs.secret) if (!pools.secretIds.has(id)) add(m.file.relPath, undefined, `${base}.effects`, `secret "${id}" not found`);
  }

  // --- tasks → items/npcs/locations + effects ---
  for (const m of arrays.tasks) {
    const t = m.data;
    const base = `tasks[${t.id}]`;
    const poolIds = t.objective.target.pool ?? [];
    let allowed: Set<string>;
    switch (t.objective.type) {
      case "deliver":
      case "gather":
      case "hunt":
        allowed = pools.itemIds;
        break;
      case "escort":
      case "persuade":
        allowed = pools.npcIds;
        break;
      case "travel":
        allowed = pools.locationIds;
        break;
      case "investigate":
        allowed = new Set([...pools.npcIds, ...pools.locationIds]);
        break;
      default:
        allowed = new Set();
    }
    for (const id of poolIds) {
      if (!allowed.has(id)) {
        add(m.file.relPath, undefined, `${base}.objective.target.pool`, `target "${id}" not found for objective type ${t.objective.type}`);
      }
    }
    for (const id of t.giver.pool) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.giver.pool`, `npc "${id}" not found`);
    const erefs = collectEffectRefs(t.rewards);
    for (const id of erefs.item) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `item "${id}" not found`);
    for (const id of erefs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `stat "${id}" not declared`);
    for (const id of erefs.skill) if (!pools.skillNames.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `skill "${id}" not declared in mechanics.yaml`);
    for (const id of erefs.need) if (!pools.needNames.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `need "${id}" not declared in mechanics.yaml`);
    for (const id of erefs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `npc "${id}" not found`);
    for (const id of erefs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `location "${id}" not found`);
    for (const id of erefs.faction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `faction "${id}" not found`);
    for (const id of erefs.status) if (!pools.statusEffectIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `status "${id}" not declared in mechanics.yaml`);
    for (const id of erefs.event) if (!pools.eventIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `event "${id}" not found`);
    for (const id of erefs.secret) if (!pools.secretIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `secret "${id}" not found`);
    for (const id of erefs.targetNpc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `target npc "${id}" not found`);
    for (const id of erefs.targetFaction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.rewards`, `target faction "${id}" not found`);
    const condRefs = newConditionRefs();
    collectConditionRefs(t.conditions, condRefs);
    collectConditionRefs(t.giver.condition, condRefs);
    for (const id of condRefs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `npc "${id}" not found`);
    for (const id of condRefs.faction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `faction "${id}" not found`);
    for (const id of condRefs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `location "${id}" not found`);
    for (const id of condRefs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `stat "${id}" not declared`);
    for (const id of condRefs.skill) if (!pools.skillNames.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `skill "${id}" not declared`);
    for (const id of condRefs.need) if (!pools.needNames.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `need "${id}" not declared`);
    for (const id of condRefs.item) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.conditions`, `item "${id}" not found`);
    checkConditionSemantics(m.file.relPath, `${base}.conditions`, t.conditions, add);
    checkConditionSemantics(m.file.relPath, `${base}.giver.condition`, t.giver.condition, add);
  }

  // --- origins → npcs/locations/items + stats/skills + denied actions ---
  for (const m of arrays.origins) {
    const o = m.data;
    const base = `origins[${o.id}]`;
    if (!pools.locationIds.has(o.starting_location)) add(m.file.relPath, undefined, `${base}.starting_location`, `location "${o.starting_location}" not found`);
    for (const id of o.items) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.items`, `item "${id}" not found`);
    for (const r of o.starting_relations) if (!pools.npcIds.has(r.npc)) add(m.file.relPath, undefined, `${base}.starting_relations`, `npc "${r.npc}" not found`);
    for (const id of o.exclusive_leads) {
      if (!pools.eventIds.has(id) && !pools.secretIds.has(id)) {
        add(m.file.relPath, undefined, `${base}.exclusive_leads`, `lead "${id}" is neither an event nor a secret`);
      }
    }
    for (const id of o.denied_actions) if (!pools.builtinActions.has(id)) add(m.file.relPath, undefined, `${base}.denied_actions`, `action "${id}" is not a builtin action`);
    for (const name of Object.keys(o.stats ?? {})) if (!pools.statNames.has(name)) add(m.file.relPath, undefined, `${base}.stats`, `stat "${name}" not declared in mechanics.yaml`);
    for (const name of Object.keys(o.skills ?? {})) if (!pools.skillNames.has(name)) add(m.file.relPath, undefined, `${base}.skills`, `skill "${name}" not declared in mechanics.yaml`);
    if (o.exclusive_to && !pools.locationIds.has(o.exclusive_to)) add(m.file.relPath, undefined, `${base}.exclusive_to`, `location "${o.exclusive_to}" not found`);
  }

  // --- npcs → stats/skills/needs/schedule/home/items/relations + secrets reveal ---
  const secretOwner = new Map<string, string>();
  for (const m of arrays.npcs) {
    const n = m.data;
    const base = `npcs[${n.id}]`;
    for (const name of Object.keys(n.stats ?? {})) if (!pools.statNames.has(name)) add(m.file.relPath, undefined, `${base}.stats`, `stat "${name}" not declared in mechanics.yaml`);
    for (const name of Object.keys(n.skills ?? {})) if (!pools.skillNames.has(name)) add(m.file.relPath, undefined, `${base}.skills`, `skill "${name}" not declared in mechanics.yaml`);
    for (const name of Object.keys(n.needs ?? {})) if (!pools.needNames.has(name)) add(m.file.relPath, undefined, `${base}.needs`, `need "${name}" not declared in mechanics.yaml`);
    if (n.schedule && !pools.scheduleIds.has(n.schedule)) add(m.file.relPath, undefined, `${base}.schedule`, `schedule "${n.schedule}" not declared in time.yaml`);
    if (n.home && !pools.locationIds.has(n.home)) add(m.file.relPath, undefined, `${base}.home`, `location "${n.home}" not found`);
    for (const id of n.items) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.items`, `item "${id}" not found`);
    for (const r of n.relations) if (!pools.npcIds.has(r.target)) add(m.file.relPath, undefined, `${base}.relations`, `relation target "${r.target}" not found`);
    for (const s of n.secrets) {
      if (secretOwner.has(s.id)) {
        add(m.file.relPath, undefined, `${base}.secrets[${s.id}].id`, `duplicate secret id "${s.id}" across npcs (first declared by ${secretOwner.get(s.id)})`);
      } else {
        secretOwner.set(s.id, n.id);
      }
      const refs = newConditionRefs();
      collectConditionRefs(s.reveal.logic, refs);
      for (const id of refs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.secrets[${s.id}].reveal`, `npc "${id}" not found`);
      checkConditionSemantics(m.file.relPath, `${base}.secrets[${s.id}].reveal.logic`, s.reveal.logic, add);
    }
    if (n.llm.dialogue_examples && !pools.exampleNpcIds.has(n.llm.dialogue_examples)) {
      add(m.file.relPath, undefined, `${base}.llm.dialogue_examples`, `dialogue examples "${n.llm.dialogue_examples}" not found in narrative/examples/`);
    }
  }

  // --- factions → npcs/factions + reputation effects ---
  for (const m of arrays.factions) {
    const f = m.data;
    const base = `factions[${f.id}]`;
    for (const id of f.members) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.members`, `npc "${id}" not found`);
    for (const r of f.relations) if (!pools.factionIds.has(r.target)) add(m.file.relPath, undefined, `${base}.relations`, `faction "${r.target}" not found`);
    for (const t of f.reputation?.thresholds ?? []) {
      const erefs = collectEffectRefs(t.effects);
      for (const id of erefs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `stat "${id}" not declared`);
      for (const id of erefs.skill) if (!pools.skillNames.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `skill "${id}" not declared in mechanics.yaml`);
      for (const id of erefs.need) if (!pools.needNames.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `need "${id}" not declared in mechanics.yaml`);
      for (const id of erefs.item) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `item "${id}" not found`);
      for (const id of erefs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `npc "${id}" not found`);
      for (const id of erefs.faction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `faction "${id}" not found`);
      for (const id of erefs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `location "${id}" not found`);
      for (const id of erefs.status) if (!pools.statusEffectIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `status "${id}" not declared in mechanics.yaml`);
      for (const id of erefs.event) if (!pools.eventIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `event "${id}" not found`);
      for (const id of erefs.secret) if (!pools.secretIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `secret "${id}" not found`);
      for (const id of erefs.targetNpc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `target npc "${id}" not found`);
      for (const id of erefs.targetFaction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.reputation.thresholds`, `target faction "${id}" not found`);
    }
  }

  // --- locations → connections/npcs/items/events + conditions ---
  for (const m of arrays.locations) {
    const l = m.data;
    const base = `locations[${l.id}]`;
    for (const c of l.connections) if (!pools.locationIds.has(c.to)) add(m.file.relPath, undefined, `${base}.connections`, `connection "${c.to}" not found`);
    for (const [i, c] of l.connections.entries()) {
      const cRefs = newConditionRefs();
      collectConditionRefs(c.condition, cRefs);
      for (const id of cRefs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `location "${id}" not found`);
      for (const id of cRefs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `npc "${id}" not found`);
      for (const id of cRefs.faction) if (!pools.factionIds.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `faction "${id}" not found`);
      for (const id of cRefs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `stat "${id}" not declared`);
      for (const id of cRefs.skill) if (!pools.skillNames.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `skill "${id}" not declared`);
      for (const id of cRefs.need) if (!pools.needNames.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `need "${id}" not declared`);
      for (const id of cRefs.item) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.connections[${i}].condition`, `item "${id}" not found`);
      checkConditionSemantics(m.file.relPath, `${base}.connections[${i}].condition`, c.condition, add);
    }
    for (const id of l.npcs_present) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.npcs_present`, `npc "${id}" not found`);
    for (const id of l.items) if (!pools.itemIds.has(id)) add(m.file.relPath, undefined, `${base}.items`, `item "${id}" not found`);
    for (const id of l.ambient_events) if (!pools.eventIds.has(id)) add(m.file.relPath, undefined, `${base}.ambient_events`, `event "${id}" not found`);
    for (const [label, cond] of [["entry_condition", l.entry_condition], ["exit_condition", l.exit_condition]] as const) {
      if (!cond) continue;
      const refs = { stat: new Set<string>(), skill: new Set<string>(), need: new Set<string>(), npc: new Set<string>(), faction: new Set<string>(), location: new Set<string>(), item: new Set<string>(), flag: new Set<string>(), fact: new Set<string>() };
      collectConditionRefs(cond, refs);
      for (const id of refs.location) if (!pools.locationIds.has(id)) add(m.file.relPath, undefined, `${base}.${label}`, `location "${id}" not found`);
      for (const id of refs.npc) if (!pools.npcIds.has(id)) add(m.file.relPath, undefined, `${base}.${label}`, `npc "${id}" not found`);
      checkConditionSemantics(m.file.relPath, `${base}.${label}`, cond, add);
    }
  }

  // --- items → effects (stats/status) + conditions ---
  for (const m of arrays.items) {
    const it = m.data;
    const base = `items[${it.id}]`;
    const erefs = collectEffectRefs(it.effects_on_use);
    for (const id of erefs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.effects_on_use`, `stat "${id}" not declared`);
    for (const id of erefs.status) if (!pools.statusEffectIds.has(id)) add(m.file.relPath, undefined, `${base}.effects_on_use`, `status "${id}" not declared in mechanics.yaml`);
    const refs = { stat: new Set<string>(), skill: new Set<string>(), need: new Set<string>(), npc: new Set<string>(), faction: new Set<string>(), location: new Set<string>(), item: new Set<string>(), flag: new Set<string>(), fact: new Set<string>() };
    collectConditionRefs(it.requirements, refs);
    for (const id of refs.stat) if (!pools.statNames.has(id)) add(m.file.relPath, undefined, `${base}.requirements`, `stat "${id}" not declared`);
    checkConditionSemantics(m.file.relPath, `${base}.requirements`, it.requirements, add);
  }

  // --- narrative: event_texts → events; examples → npcs ---
  for (const m of arrays.eventTexts) {
    if (!pools.eventIds.has(m.data.event_id)) {
      add(m.file.relPath, undefined, "event_id", `event "${m.data.event_id}" not found in events/`);
    }
  }
  for (const m of arrays.examples) {
    if (m.data.npc_id !== "generic" && !pools.npcIds.has(m.data.npc_id)) {
      add(m.file.relPath, undefined, "npc_id", `npc "${m.data.npc_id}" not found`);
    }
  }
}

/** Validates an entire script directory. Returns issues with file/line context. */
export function validateScriptDir(scriptDir: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const rootName = path.basename(path.resolve(scriptDir));

  // --- Load root modules ---
  const modules: Record<string, ParsedModule<unknown>> = {};
  for (const mod of ROOT_MODULES) {
    const absPath = path.join(scriptDir, `${mod.name}.yaml`);
    let file: LoadedYamlFile;
    try {
      file = loadYamlFile(absPath, `${mod.name}.yaml`);
    } catch (err) {
      if (mod.required) {
        issues.push({
          file: `${mod.name}.yaml`,
          path: "(root)",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    const data = validateModule(file, mod.schema, issues);
    if (data !== undefined) modules[mod.name] = { file, data };
  }

  // --- Directory name must equal script id ---
  const script = modules["script"]?.data as z.infer<typeof scriptSchema> | undefined;
  if (script && script.id !== rootName) {
    issues.push({
      file: "script.yaml",
      path: "id",
      message: `script id "${script.id}" must equal directory name "${rootName}"`,
    });
  }

  // --- Load entity directories ---
  const dirs = {
    origins: { dir: "origins", required: true },
    npcs: { dir: "npcs", required: true },
    locations: { dir: "locations", required: true },
    items: { dir: "items", required: false },
    factions: { dir: "factions", required: false },
    events: { dir: "events", required: false },
    tasks: { dir: "tasks", required: false },
  } as const;
  const arrays: {
    origins: ParsedModule<z.infer<typeof originSchema>>[];
    npcs: ParsedModule<z.infer<typeof npcSchema>>[];
    locations: ParsedModule<z.infer<typeof locationSchema>>[];
    items: ParsedModule<z.infer<typeof itemSchema>>[];
    factions: ParsedModule<z.infer<typeof factionSchema>>[];
    events: ParsedModule<z.infer<typeof eventSchema>>[];
    tasks: ParsedModule<z.infer<typeof taskSchema>>[];
    lore: ParsedModule<z.infer<typeof loreEntrySchema>>[];
    examples: ParsedModule<z.infer<typeof exampleDialogueSchema>>[];
    eventTexts: ParsedModule<z.infer<typeof eventTextSchema>>[];
  } = {
    origins: [],
    npcs: [],
    locations: [],
    items: [],
    factions: [],
    events: [],
    tasks: [],
    lore: [],
    examples: [],
    eventTexts: [],
  };

  const dirSchemaMap: Record<
    keyof typeof dirs,
    z.ZodType<unknown>
  > = {
    origins: originSchema,
    npcs: npcSchema,
    locations: locationSchema,
    items: itemSchema,
    factions: factionSchema,
    events: eventSchema,
    tasks: taskSchema,
  };

  for (const [key, { dir: dirName, required }] of Object.entries(dirs) as Array<
    [keyof typeof dirs, { dir: string; required: boolean }]
  >) {
    const absDir = path.join(scriptDir, dirName);
    let files: LoadedYamlFile[];
    try {
      files = loadYamlFilesFromDir(absDir, dirName);
    } catch (err) {
      issues.push({ file: dirName, path: "(root)", message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (files.length === 0) {
      if (required) {
        issues.push({ file: `${dirName}/`, path: "(root)", message: `required directory "${dirName}/" is empty or missing` });
      }
      continue;
    }
    for (const file of files) {
      const data = validateModule(file, dirSchemaMap[key], issues);
      if (data !== undefined) {
        (arrays[key] as Array<ParsedModule<unknown>>).push({ file, data });
      }
    }
  }

  // --- narrative/ subdirectories ---
  const narrativeBase = path.join(scriptDir, "narrative");
  const narrativeFiles = loadYamlFilesFromDir(narrativeBase, "narrative");
  const narrativeRequired: Array<{ name: string; schema: z.ZodType }> = [
    { name: "opening", schema: openingSchema },
    { name: "style", schema: styleSchema },
  ];
  for (const req of narrativeRequired) {
    const found = narrativeFiles.find((f) => f.relPath === `narrative/${req.name}.yaml`);
    if (!found) {
      issues.push({ file: `narrative/${req.name}.yaml`, path: "(root)", message: `required narrative file narrative/${req.name}.yaml is missing` });
      continue;
    }
    const data = validateModule(found, req.schema, issues);
    if (data !== undefined) modules[req.name] = { file: found, data };
  }
  // Optional narrative subdirectories
  const loreFiles = loadYamlFilesFromDir(path.join(narrativeBase, "lore"), "narrative/lore");
  for (const file of loreFiles) {
    const data = validateModule(file, loreEntrySchema, issues);
    if (data !== undefined) arrays.lore.push({ file, data });
  }
  const exampleFiles = loadYamlFilesFromDir(path.join(narrativeBase, "examples"), "narrative/examples");
  for (const file of exampleFiles) {
    const data = validateModule(file, exampleDialogueSchema, issues);
    if (data !== undefined) arrays.examples.push({ file, data });
  }
  const eventTextFiles = loadYamlFilesFromDir(path.join(narrativeBase, "event_texts"), "narrative/event_texts");
  for (const file of eventTextFiles) {
    const data = validateModule(file, eventTextSchema, issues);
    if (data !== undefined) arrays.eventTexts.push({ file, data });
  }

  // --- Semantic reference checks (only when required modules parsed) ---
  const requiredParsed = ["script", "world", "time", "mechanics", "actions", "plot", "director", "worldgen", "run", "safety"].every(
    (name) => modules[name] !== undefined,
  );
  if (requiredParsed) {
    checkReferences(modules, arrays, issues);
  }

  return {
    ok: issues.length === 0,
    issues,
    scriptId: script?.id ?? rootName,
  };
}
