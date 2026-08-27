import { describe, expect, it } from "vitest";
import {
  CONTROL_POSITION_KEY,
  PREFERENCES_KEY,
  defaultPreferences,
  parsePreferences,
} from "../browser-state";

describe("browser preferences", () => {
  it("keeps the full-truth inspector hidden by default", () => {
    expect(CONTROL_POSITION_KEY).toBe("livingworld:control-position:v3");
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
