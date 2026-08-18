// Narrative module schemas re-exported (module 18).
import {
  eventTextSchema,
  exampleDialogueSchema,
  loreEntrySchema,
  openingSchema,
  styleSchema,
} from "./narrative";

export const narrativeSchemas = {
  opening: openingSchema,
  style: styleSchema,
  lore: loreEntrySchema,
  examples: exampleDialogueSchema,
  event_texts: eventTextSchema,
};

export {
  eventTextSchema,
  exampleDialogueSchema,
  loreEntrySchema,
  openingSchema,
  styleSchema,
};
