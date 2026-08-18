// Aggregate schema exports for the script format v1.0.
// Import this to validate any module of a script.
import { actionsSchema, builtinActionIdSchema } from "./actions";
import { directorSchema } from "./director";
import { eventSchema } from "./event";
import { factionSchema } from "./faction";
import { itemSchema } from "./item";
import { locationSchema } from "./location";
import { mechanicsSchema } from "./mechanics";
import { npcSchema } from "./npc";
import { originSchema } from "./origin";
import { plotSchema } from "./plot";
import { runSchema } from "./run";
import { safetySchema } from "./safety";
import { scriptSchema } from "./script";
import { taskSchema } from "./task";
import { timeSchema } from "./time";
import { worldSchema } from "./world";
import { worldgenSchema } from "./worldgen";

export {
  actionsSchema,
  builtinActionIdSchema,
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
  taskSchema,
  timeSchema,
  worldSchema,
  worldgenSchema,
};

export * from "./common";
export * from "./narrative-index";
