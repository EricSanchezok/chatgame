import { describe, expect, it } from "vitest";
import {
  Badge,
  Button,
  Checkbox,
  Frame,
  FramePanel,
  Input,
  InputGroup,
  SCRIPT_UI_API_VERSION,
  Select,
  SettingRow,
  Slider,
  Switch,
  Textarea,
} from "../ui-api";

describe("shared UI runtime", () => {
  it("exports the complete UI API v6 primitive surface", () => {
    expect(SCRIPT_UI_API_VERSION).toBe(6);
    for (const primitive of [Button, Badge, Frame, FramePanel, Input, InputGroup, Select, Switch, Slider, Checkbox, SettingRow, Textarea]) {
      expect(primitive).toBeTypeOf("function");
    }
  });
});
