import { describe, expect, it } from "vitest";
import {
  ActionChoice,
  Badge,
  Button,
  Checkbox,
  Frame,
  FramePanel,
  Input,
  InputGroup,
  Metric,
  SCRIPT_UI_API_VERSION,
  Select,
  SettingRow,
  Slider,
  Switch,
  Textarea,
} from "../ui-api";

describe("shared UI runtime", () => {
  it("exports the complete UI API v5 primitive surface", () => {
    expect(SCRIPT_UI_API_VERSION).toBe(5);
    for (const primitive of [Button, Badge, Frame, FramePanel, Input, InputGroup, Select, Switch, Slider, Checkbox, SettingRow, Textarea, ActionChoice, Metric]) {
      expect(primitive).toBeTypeOf("function");
    }
  });
});
