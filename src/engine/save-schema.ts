import { z } from "zod";
import type { SaveFile, WorldState } from "./types";

export const SAVE_SCHEMA_VERSION = 5 as const;

const numberMapSchema = z.record(z.string(), z.number());
const descriptorSchema = z.object({
  label: z.string(),
  description: z.string(),
  version: z.number(),
  stale: z.boolean(),
  sourceEventIds: z.array(z.string()),
  userEdited: z.boolean(),
}).strict();
const inventorySchema = z.object({
  stacks: z.array(z.object({ itemId: z.string(), quantity: z.number() }).strict()),
  currency: z.number(),
}).strict();
const needStateSchema = z.object({ value: z.number(), descriptor: descriptorSchema.optional() }).strict();
const relationSchema = z.object({
  npcId: z.string(),
  value: z.number(),
  stance: z.string(),
  type: z.string(),
  description: z.string().optional(),
  descriptor: descriptorSchema.optional(),
}).strict();
const reputationSchema = z.object({
  factionId: z.string(),
  value: z.number(),
  descriptor: descriptorSchema.optional(),
}).strict();
const statusSchema = z.object({
  statusId: z.string(),
  remainingTicks: z.number().nullable(),
  stacks: z.number(),
  descriptor: descriptorSchema.optional(),
}).strict();
const memorySchema = z.object({
  id: z.string(),
  text: z.string(),
  importance: z.enum(["major", "minor", "trivial"]),
  tags: z.array(z.string()),
  createdAtDay: z.number(),
  strength: z.number(),
  lastAccessedDay: z.number().nullable(),
  lastDecayDay: z.number(),
  archived: z.boolean(),
  supersededBy: z.string().optional(),
}).strict();
const npcSchema = z.object({
  id: z.string(),
  stats: numberMapSchema,
  skills: numberMapSchema,
  needs: z.record(z.string(), needStateSchema),
  inventory: inventorySchema,
  relations: z.array(relationSchema),
  memories: z.array(memorySchema),
  knowledgeFlags: z.array(z.string()),
  revealedSecrets: z.array(z.string()),
  currentLocationId: z.string(),
  statuses: z.array(statusSchema),
  reputation: z.array(reputationSchema),
}).strict();
const playerSchema = z.object({
  originId: z.string(),
  name: z.string(),
  stats: numberMapSchema,
  skills: numberMapSchema,
  needs: z.record(z.string(), needStateSchema),
  inventory: inventorySchema,
  locationId: z.string(),
  flags: z.array(z.string()),
  threatGauge: z.number(),
  statuses: z.array(statusSchema),
  memories: z.array(memorySchema),
  relations: z.array(relationSchema),
  reputation: z.array(reputationSchema),
}).strict();
const clockSchema = z.object({
  totalHours: z.number(),
  day: z.number(),
  month: z.number(),
  year: z.number(),
  hour: z.number(),
  weekday: z.number(),
  weather: z.string(),
  season: z.string(),
}).strict();
const taskSchema = z.discriminatedUnion("status", [
  z.object({
    taskId: z.string(),
    status: z.literal("active"),
    acceptedDay: z.number(),
    acceptedEventCount: z.number(),
    progress: z.number(),
  }).strict(),
  z.object({
    taskId: z.string(),
    status: z.literal("complete"),
    acceptedDay: z.number(),
    completedDay: z.number(),
  }).strict(),
  z.object({
    taskId: z.string(),
    status: z.literal("failed"),
    acceptedDay: z.number(),
    failedDay: z.number(),
  }).strict(),
]);
const mediaCueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("npc_speech"), npcId: z.string() }).strict(),
  z.object({ kind: z.literal("location_enter"), locationId: z.string() }).strict(),
  z.object({ kind: z.literal("event"), eventId: z.string() }).strict(),
  z.object({ kind: z.literal("item_reveal"), itemId: z.string(), quantity: z.number().int().positive() }).strict(),
]);

export const worldStateSchema = z.object({
  scriptId: z.string(),
  clock: clockSchema,
  player: playerSchema,
  npcs: z.record(z.string(), npcSchema),
  flags: z.array(z.string()),
  facts: z.array(z.string()),
  eventLog: z.array(z.object({
    id: z.string(),
    day: z.number(),
    hour: z.number(),
    type: z.enum(["action", "resolution", "commitment", "director", "world", "system"]),
    actor: z.string(),
    summary: z.string(),
    detail: z.unknown().optional(),
  }).strict()),
  commitments: z.array(z.object({
    commitmentId: z.string(),
    triggered: z.boolean(),
    deadlineMissed: z.boolean(),
    triggeredAtDay: z.number().optional(),
  }).strict()),
  director: z.object({
    lastEventDay: z.number().nullable(),
    tension: numberMapSchema,
  }).strict(),
  rng: z.object({ seed: z.number(), state: z.number() }).strict(),
  tasks: z.array(taskSchema),
  playedEventIds: z.array(z.string()),
  eventLastPlayedDay: numberMapSchema,
  actionCooldowns: numberMapSchema,
  secretHolders: z.record(z.string(), z.string()),
  locationInventories: z.record(z.string(), inventorySchema),
  transcript: z.array(z.object({
    id: z.string(),
    turn: z.number(),
    role: z.enum(["player", "world", "system"]),
    text: z.string(),
    mediaCues: z.array(mediaCueSchema),
  }).strict()),
  contextSummary: z.object({
    text: z.string(),
    lastSummaryTurn: z.number(),
    sourceTurnRange: z.tuple([z.number(), z.number()]),
  }).strict().optional(),
  runtimeState: z.record(z.string(), z.unknown()),
  activeNeedThresholds: z.array(z.string()),
}).strict() satisfies z.ZodType<WorldState>;

export const saveFileSchema = z.object({
  saveSchemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  scriptId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  worldState: worldStateSchema,
}).strict().superRefine((save, context) => {
  if (save.scriptId !== save.worldState.scriptId) {
    context.addIssue({
      code: "custom",
      path: ["worldState", "scriptId"],
      message: "must match the save envelope scriptId",
    });
  }
}) satisfies z.ZodType<SaveFile>;
