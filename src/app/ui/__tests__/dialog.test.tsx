// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Dialog } from "../dialog";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开</button>
      {open ? (
        <Dialog title="测试对话框" onClose={() => setOpen(false)}>
          <button type="button" data-autofocus>第一项</button>
          <button type="button">最后一项</button>
        </Dialog>
      ) : null}
    </>
  );
}

describe("Dialog", () => {
  it("traps focus, closes on Escape and restores the opener", async () => {
    const { container } = render(<Harness />);
    const opener = screen.getByRole("button", { name: "打开" });
    opener.focus();
    fireEvent.click(opener);
    const first = await screen.findByRole("button", { name: "第一项" });
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(container).toHaveProperty("inert", true);

    const close = screen.getByRole("button", { name: "关闭测试对话框" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "最后一项" }));

    const last = screen.getByRole("button", { name: "最后一项" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog").parentElement).toHaveClass("cg-dialog-layer--closing");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("keeps focus on the dialog surface if every control becomes unavailable", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const dialog = await screen.findByRole("dialog");
    for (const button of dialog.querySelectorAll("button")) button.disabled = true;
    dialog.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
  });

  it("does not retain the visual exit delay when reduced motion is selected", async () => {
    document.documentElement.dataset.cgMotionPreference = "reduce";
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    delete document.documentElement.dataset.cgMotionPreference;
  });
});
