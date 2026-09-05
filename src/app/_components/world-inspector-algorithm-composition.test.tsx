// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ALGORITHM_REF } from "../../engine/algorithms/registry";
import { WorldInspectorAlgorithmComposition } from "./world-inspector-algorithm-composition";

afterEach(cleanup);

describe("WorldInspectorAlgorithmComposition", () => {
  it("renders recursive identities, paths, and pinned configuration", () => {
    render(<WorldInspectorAlgorithmComposition composition={{ root: DEFAULT_ALGORITHM_REF, nodeCount: 23 }} query="candidateSelection" />);

    expect(screen.getByRole("heading", { name: "算法 Composition" })).toBeTruthy();
    expect(screen.getByText("full-catalog@1")).toBeTruthy();
    expect(screen.getByText("root.actionCompilation.candidateSelection")).toBeTruthy();
    expect(screen.getByText("candidate-selection v1")).toBeTruthy();
  });

  it("reports an empty filtered view without hiding the search result from assistive technology", () => {
    render(<WorldInspectorAlgorithmComposition composition={{ root: DEFAULT_ALGORITHM_REF, nodeCount: 23 }} query="missing-algorithm" />);

    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的算法");
  });
});
