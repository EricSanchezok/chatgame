// Module 3: time.yaml — time mechanics.
import { z } from "zod";
import { extSchema, idSchema, monthDaySchema, timeOfDaySchema } from "./common";

export const calendarMonthSchema = z
  .object({
    name: z.string().min(1),
    days: z.number().int().positive(),
  })
  .strict();

export const weatherEntrySchema = z
  .object({
    weather: z.string().min(1),
    weight: z.number().nonnegative(),
  })
  .strict();

export const seasonSchema = z
  .object({
    name: z.string().min(1),
    start: monthDaySchema,
    weather_table: z.array(weatherEntrySchema).min(1),
  })
  .strict();

export const festivalSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    date: monthDaySchema,
    event: idSchema.optional(),
  })
  .strict();

export const scheduleEntrySchema = z
  .object({
    from: timeOfDaySchema,
    to: timeOfDaySchema,
    activity: z.string().min(1),
    location: idSchema.optional(),
  })
  .strict();

export const scheduleSchema = z
  .object({
    id: idSchema,
    entries: z.array(scheduleEntrySchema).min(1),
  })
  .strict();

export const timeSchema = z
  .object({
    unit: z.literal("hour"),
    day_length_hours: z.number().int().positive(),
    calendar: z
      .object({
        months: z.array(calendarMonthSchema).min(1),
        weekdays: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    seasons: z.array(seasonSchema).optional(),
    festivals: z.array(festivalSchema).optional(),
    schedules: z.array(scheduleSchema).min(1),
    world_advances: z.boolean(),
    advance_mode: z.literal("rule_based"),
    advance_scope: z
      .array(
        z.enum(["schedules", "needs", "events", "factions", "time_events"]),
      )
      .min(1),
    ext: extSchema,
  })
  .strict();

export type Time = z.infer<typeof timeSchema>;
