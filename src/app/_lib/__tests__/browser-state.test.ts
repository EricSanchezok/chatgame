import { describe, expect, it } from "vitest";
import {
  PREFERENCES_KEY,
  defaultPreferences,
  parsePreferences,
} from "../browser-state";

describe("browser preferences", () => {
  it("keeps the full-truth inspector hidden by default", () => {
    expect(PREFERENCES_KEY).toBe("livingworld:preferences:v2");
    expect(defaultPreferences.showWorldInspector).toBe(false);
    expect(parsePreferences("")).toEqual(defaultPreferences);
  });

  it("accepts only explicit inspector and motion opt-ins", () => {
    expect(parsePreferences(JSON.stringify({
      fontScale: "large",
      reduceMotion: true,
      showWorldInspector: true,
    }))).toEqual({
      advancedRoleControl: false,
      fontScale: "large",
      reduceMotion: true,
      showWorldInspector: true,
    });
    expect(parsePreferences(JSON.stringify({
      fontScale: "unknown",
      reduceMotion: "yes",
      showWorldInspector: 1,
    }))).toEqual(defaultPreferences);
  });
});
