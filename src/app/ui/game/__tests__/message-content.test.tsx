// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameMessageContent } from "../message-content";

afterEach(cleanup);

describe("GameMessageContent", () => {
  it("uses Markdown paragraphs instead of turning every source newline into a hard break", () => {
    const { container } = render(
      <GameMessageContent content={"第一段第一行\n仍属于第一段。\n\n第二段。\n\n- 甲\n- 乙"} />,
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(0);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("p")?.textContent).toBe("第一段第一行\n仍属于第一段。");
  });

  it("renders GFM tables inside a keyboard-scrollable wrapper", () => {
    const { container } = render(
      <GameMessageContent content={"| 项目 | 状态 |\n| --- | --- |\n| 线路 | 正常 |"} />,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector(".cg-message-content__table")?.getAttribute("tabindex")).toBe("0");
  });
});
