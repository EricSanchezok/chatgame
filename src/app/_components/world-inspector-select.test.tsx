// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldInspectorSelect } from "./world-inspector-select";

const options = [
  { value: "stage", label: "引擎顺序" },
  { value: "timestamp", label: "时间" },
  { value: "duration", label: "耗时" },
] as const;

describe("WorldInspectorSelect", () => {
  afterEach(cleanup);

  it("renders the product-styled listbox instead of a native select popup", () => {
    render(<WorldInspectorSelect ariaLabel="排序" onChange={() => {}} options={options} value="stage" />);

    const trigger = screen.getByRole("button", { name: "排序：引擎顺序" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "排序" })).toBeVisible();
    expect(screen.getByRole("option", { name: "引擎顺序" })).toHaveAttribute("aria-selected", "true");
  });

  it("supports arrow navigation, selection and Escape focus restoration", () => {
    const onChange = vi.fn();
    render(<WorldInspectorSelect ariaLabel="排序" onChange={onChange} options={options} value="stage" />);
    const trigger = screen.getByRole("button", { name: "排序：引擎顺序" });

    fireEvent.click(trigger);
    const menu = screen.getByRole("listbox");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("timestamp");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "排序：引擎顺序" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "排序：引擎顺序" }));
  });
});
