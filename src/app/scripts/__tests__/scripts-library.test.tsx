// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpGamePort } from "../../lib/api";
import { ScriptsLibrary } from "../scripts-library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScriptsLibrary import preview", () => {
  it("renders the staged cover through its opaque preview URL", async () => {
    vi.spyOn(httpGamePort, "listScripts").mockResolvedValue({ scripts: [] });
    vi.spyOn(httpGamePort, "previewImport").mockResolvedValue({
      token: "00000000-0000-0000-0000-000000000001",
      scriptId: "preview-script",
      name: "预检剧本",
      sourceName: "preview.zip",
      schemaVersion: "1.1",
      apiVersions: { hostUi: 3, engine: null, scriptUi: null },
      cover: { file: "assets/cover.svg", alt: "预检封面" },
      coverUrl: "/api/scripts/import/preview/00000000-0000-0000-0000-000000000001/cover",
      conflicts: { installed: false, replaceAllowed: false },
      permissions: ["assets"],
      assetProvenance: { manifestPresent: true, coveredFiles: 1, totalFiles: 1, missingFiles: [], extraFiles: [], remoteReferences: [] },
      risks: [],
      errors: [],
      warnings: [],
    });
    const { container } = render(<ScriptsLibrary />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["zip"], "preview.zip", { type: "application/zip" })] } });
    const cover = await screen.findByRole("img", { name: "预检封面" });
    expect(cover).toHaveAttribute("src", "/api/scripts/import/preview/00000000-0000-0000-0000-000000000001/cover");
  });
});
