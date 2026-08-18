// GameClock: engine-managed deterministic time. All time flows through
// here (never Date.now) — schedules, needs decay, commitments and the
// director all read the clock. One canonical unit: total hours.
import type { GameClock } from "./types";
import type { WorldDefinition } from "./types";

/** Creates the starting clock at day 1, month 1, year 1, hour 0. */
export function createClock(definition: WorldDefinition, weather: string, season: string): GameClock {
  return {
    totalHours: 0,
    day: 1,
    month: 1,
    year: 1,
    hour: 0,
    weekday: 0,
    weather,
    season,
  };
}

/** Total hours in one day from the time definition. */
export function hoursPerDay(definition: WorldDefinition): number {
  return definition.time.day_length_hours;
}

/** Total days in a month (from calendar months list). */
export function daysInMonth(definition: WorldDefinition, monthIndex: number): number {
  const months = definition.time.calendar.months;
  const idx = ((monthIndex - 1) % months.length + months.length) % months.length;
  return months[idx].days;
}

/**
 * Advances the clock by `hours` (>= 0). Pure update: returns a new clock.
 * Weekday cycles over calendar.weekdays; month/year roll over at month end.
 */
export function advanceClock(
  clock: GameClock,
  definition: WorldDefinition,
  hours: number,
): GameClock {
  if (hours < 0) throw new Error("advanceClock: hours must be >= 0");
  if (hours === 0) return clock;

  const dayLength = hoursPerDay(definition);
  const weekdayCount = definition.time.calendar.weekdays.length;
  const monthCount = definition.time.calendar.months.length;

  const totalHours = clock.totalHours + hours;
  let day = clock.day;
  let month = clock.month;
  let year = clock.year;
  let hour = clock.hour;
  let weekday = clock.weekday;

  hour += hours % dayLength;
  let dayRolls = Math.floor(hours / dayLength);
  if (hour >= dayLength) {
    hour -= dayLength;
    dayRolls += 1;
  }

  if (dayRolls > 0) {
    // Walk day by day so month boundaries are exact.
    for (let i = 0; i < dayRolls; i++) {
      const daysThisMonth = daysInMonth(definition, month);
      day += 1;
      weekday = (weekday + 1) % weekdayCount;
      if (day > daysThisMonth) {
        day = 1;
        month += 1;
        if (month > monthCount) {
          month = 1;
          year += 1;
        }
      }
    }
  }

  return { ...clock, totalHours, day, month, year, hour, weekday };
}

/** Absolute day number (totalHours / dayLength, 0-based). */
export function absoluteDay(definition: WorldDefinition, clock: GameClock): number {
  return Math.floor(clock.totalHours / hoursPerDay(definition));
}

/** Returns the current season label (first season whose start <= now, else last). */
export function currentSeason(definition: WorldDefinition, clock: GameClock): string {
  const seasons = definition.time.seasons ?? [];
  if (seasons.length === 0) return "常";
  // Compare (month, day) tuples in ascending order; the current season is
  // the LAST start <= now (before the year's first start it wraps to the
  // final season). Seasons are assumed sorted by start.
  const nowKey = clock.month * 100 + clock.day;
  let current = seasons[seasons.length - 1].name;
  for (const season of seasons) {
    const [m, d] = season.start.split("-").map(Number);
    const key = m * 100 + d;
    if (key > nowKey) break; // seasons sorted; later starts cannot match
    current = season.name;
  }
  return current;
}

/** Returns the name of today's festival, if any. */
export function todayFestival(definition: WorldDefinition, clock: GameClock): string | undefined {
  for (const festival of definition.time.festivals ?? []) {
    const [m, d] = festival.date.split("-").map(Number);
    if (m === clock.month && d === clock.day) return festival.id;
  }
  return undefined;
}

/** Format helper for display: "第3年 4月5日 14:00 春". */
export function formatClock(clock: GameClock): string {
  return `第${clock.year}年 ${clock.month}月${clock.day}日 ${String(clock.hour).padStart(2, "0")}:00 ${clock.weather} ${clock.season}`;
}

/** Returns the activity+location for an NPC schedule at the current time. */
export function scheduleAt(
  definition: WorldDefinition,
  scheduleId: string,
  clock: GameClock,
): { activity: string; locationId?: string } | undefined {
  const schedule = definition.time.schedules.find((s) => s.id === scheduleId);
  if (!schedule) return undefined;
  const timeKey = clock.hour * 60; // minutes since midnight
  for (const entry of schedule.entries) {
    const [fromH, fromM] = entry.from.split(":").map(Number);
    const [toH, toM] = entry.to.split(":").map(Number);
    const from = fromH * 60 + fromM;
    const to = toH * 60 + toM;
    // Entries are assumed to be within one day (from < to).
    if (timeKey >= from && timeKey < to) {
      return { activity: entry.activity, locationId: entry.location };
    }
  }
  return undefined;
}

/** True when the world is configured to advance while the player is away. */
export function worldAdvances(definition: WorldDefinition): boolean {
  return definition.time.world_advances;
}

/** Hours elapsed between two clocks (for offline advance computation). */
export function hoursBetween(definition: WorldDefinition, from: GameClock, to: GameClock): number {
  return to.totalHours - from.totalHours;
}


