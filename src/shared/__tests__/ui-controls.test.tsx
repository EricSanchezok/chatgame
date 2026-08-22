// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox, Input, Select, SettingRow, Slider, Switch } from "../ui-api";

afterEach(cleanup);

describe("shared controlled UI controls", () => {
  it("renders Input and Select from controlled values", () => {
    const inputChange = vi.fn();
    const selectChange = vi.fn();
    const { rerender } = render(
      <>
        <label htmlFor="name">名字</label>
        <Input id="name" value="阿澄" onChange={inputChange} />
        <SettingRow controlId="theme" label="主题">
          <Select id="theme" value="follow" onValueChange={selectChange} options={[{ value: "follow", label: "跟随剧本" }, { value: "fixed", label: "固定主题" }]} />
        </SettingRow>
      </>,
    );
    expect(screen.getByRole("textbox", { name: "名字" })).toHaveValue("阿澄");
    expect(screen.getByRole("combobox", { name: "主题" })).toHaveTextContent("跟随剧本");
    rerender(<SettingRow controlId="theme" label="主题"><Select id="theme" value="fixed" onValueChange={selectChange} options={[{ value: "follow", label: "跟随剧本" }, { value: "fixed", label: "固定主题" }]} /></SettingRow>);
    expect(screen.getByRole("combobox", { name: "主题" })).toHaveTextContent("固定主题");
  });

  it("reports controlled Switch, Checkbox and Slider changes", () => {
    const switchChange = vi.fn();
    const checkboxChange = vi.fn();
    const sliderChange = vi.fn();
    render(
      <>
        <SettingRow controlId="sound" label="声音"><Switch id="sound" checked={false} onCheckedChange={switchChange} /></SettingRow>
        <div><Checkbox id="trust" checked={false} onCheckedChange={checkboxChange} /><label htmlFor="trust">信任来源</label></div>
        <Slider aria-label="总音量" min={0} max={100} value={40} onValueChange={sliderChange} />
      </>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "声音" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "信任来源" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "总音量" }), { key: "ArrowRight" });
    expect(switchChange).toHaveBeenCalledWith(true);
    expect(checkboxChange).toHaveBeenCalledWith(true);
    expect(sliderChange).toHaveBeenCalledWith(41);
  });
});
