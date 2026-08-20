import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitScriptImport,
  previewScriptImportFromZip,
  readImportPreviewCover,
  removeInstalledScript,
  ScriptImportError,
  scriptInstallSource,
} from "../script-import";

const REPO_ROOT = path.resolve(__dirname, "../../..");
let root: string;
let scriptsRoot: string;
let stagingRoot: string;

beforeEach(() => {
  root = path.join(tmpdir(), `cg-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  scriptsRoot = path.join(root, "scripts");
  stagingRoot = path.join(root, "staging");
  mkdirSync(scriptsRoot, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixtureAssetFiles(dir: string, base = "assets"): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = path.join(dir, entry);
    const relative = `${base}/${entry}`;
    return statSync(absolute).isDirectory() ? fixtureAssetFiles(absolute, relative) : [relative];
  });
}

function fixtureProvenance(): string {
  const assets = path.join(REPO_ROOT, "scripts", "starlight", "assets");
  return [
    "version: 1",
    "files:",
    ...fixtureAssetFiles(assets).flatMap((file) => [
      `  ${JSON.stringify(file)}:`,
      "    source: chatgame test fixture",
      "    license: test-only",
    ]),
    "",
  ].join("\n");
}

function starlightZip(options: { provenance?: boolean } = { provenance: true }): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(path.join(REPO_ROOT, "scripts", "starlight"), "starlight");
  if (options.provenance !== false) {
    zip.addFile("starlight/assets/provenance.yaml", Buffer.from(fixtureProvenance()));
  }
  return zip.toBuffer();
}

describe("two-stage script import", () => {
  it("previews schema, APIs, cover, permissions and then commits", () => {
    const preview = previewScriptImportFromZip(starlightZip(), {
      sourceName: "trusted-starlight.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(preview).toMatchObject({
      scriptId: "starlight",
      schemaVersion: "1.1",
      apiVersions: { hostUi: 3, engine: 2, scriptUi: 3 },
      conflicts: { installed: false, replaceAllowed: false },
      errors: [],
    });
    expect(preview.cover?.file).toBe("assets/backgrounds/bridge.svg");
    expect(preview.coverUrl).toBe(`/api/scripts/import/preview/${preview.token}/cover`);
    expect(readImportPreviewCover(preview.token, { stagingRoot }).mimeType).toBe("image/svg+xml");
    expect(preview.permissions).toEqual(expect.arrayContaining(["engine", "ui", "assets"]));
    expect(preview.assetProvenance).toMatchObject({ manifestPresent: true, coveredFiles: preview.assetProvenance.totalFiles, missingFiles: [] });

    expect(commitScriptImport(preview.token, { replace: false, scriptsRoot, stagingRoot })).toMatchObject({ scriptId: "starlight" });
    expect(scriptInstallSource(path.join(scriptsRoot, "starlight"))).toEqual({ kind: "imported", label: "trusted-starlight.zip" });
  });

  it("requires an explicit replace confirmation for conflicts", () => {
    const first = previewScriptImportFromZip(starlightZip(), { sourceName: "first.zip", scriptsRoot, stagingRoot });
    commitScriptImport(first.token, { replace: false, scriptsRoot, stagingRoot });
    const conflict = previewScriptImportFromZip(starlightZip(), { sourceName: "second.zip", scriptsRoot, stagingRoot });
    expect(conflict.conflicts.installed).toBe(true);
    expect(conflict.conflicts.replaceAllowed).toBe(true);
    expect(() => commitScriptImport(conflict.token, { replace: false, scriptsRoot, stagingRoot }))
      .toThrow(/confirm replacement/);

    const confirmed = previewScriptImportFromZip(starlightZip(), { sourceName: "second.zip", scriptsRoot, stagingRoot });
    expect(() => commitScriptImport(confirmed.token, { replace: true, scriptsRoot, stagingRoot })).not.toThrow();
  });

  it("never replaces or deletes a built-in script", () => {
    const builtIn = path.join(scriptsRoot, "starlight");
    mkdirSync(builtIn, { recursive: true });
    const sourceScript = path.join(REPO_ROOT, "scripts", "starlight", "script.yaml");
    const original = statSync(sourceScript).size;
    const zip = starlightZip();
    // A directory without an installation receipt is owned by the application.
    const unpacked = new AdmZip(zip);
    unpacked.extractAllTo(scriptsRoot, true);
    const preview = previewScriptImportFromZip(zip, { sourceName: "replacement.zip", scriptsRoot, stagingRoot });
    expect(preview.conflicts).toEqual({ installed: true, replaceAllowed: false });
    expect(preview.errors).toEqual(expect.arrayContaining([expect.stringContaining("cannot be replaced")]));
    expect(() => commitScriptImport(preview.token, { replace: true, scriptsRoot, stagingRoot })).toThrow(/validation errors/);
    expect(statSync(path.join(builtIn, "script.yaml")).size).toBe(original);
    expect(() => removeInstalledScript("starlight", { scriptsRoot })).toThrow(/cannot be deleted/);
    expect(existsSync(path.join(builtIn, "script.yaml"))).toBe(true);
  });

  it("returns validation errors in preview and refuses commit", () => {
    const zip = new AdmZip();
    zip.addFile("broken/script.yaml", Buffer.from("id: Broken\nname: 未完成"));
    const preview = previewScriptImportFromZip(zip.toBuffer(), {
      sourceName: "broken.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(preview.errors.length).toBeGreaterThan(0);
    expect(() => commitScriptImport(preview.token, { replace: false, scriptsRoot, stagingRoot }))
      .toThrow(ScriptImportError);
    expect(existsSync(path.join(scriptsRoot, "Broken"))).toBe(false);
  });

  it("lists uncovered asset provenance and refuses remote hotlinks", () => {
    const missing = previewScriptImportFromZip(starlightZip({ provenance: false }), {
      sourceName: "unattributed.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(missing.assetProvenance.manifestPresent).toBe(false);
    expect(missing.assetProvenance.missingFiles.length).toBeGreaterThan(0);
    expect(missing.errors).toEqual(expect.arrayContaining([expect.stringContaining("provenance.yaml")]));

    const zip = new AdmZip(starlightZip());
    const manifest = zip.getEntry("starlight/assets.yaml")!.getData().toString("utf8");
    zip.updateFile("starlight/assets.yaml", Buffer.from(manifest.replace(
      "assets/backgrounds/bridge.svg",
      "https://cdn.example.invalid/bridge.svg",
    )));
    const hotlink = previewScriptImportFromZip(zip.toBuffer(), {
      sourceName: "hotlink.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(hotlink.assetProvenance.remoteReferences).toEqual([expect.stringContaining("https://")]);
    expect(hotlink.errors).toEqual(expect.arrayContaining([expect.stringContaining("remote asset hotlink")]));
  });

  it("lists stale provenance records as warnings without blocking installation", () => {
    const zip = new AdmZip(starlightZip());
    const provenance = zip.getEntry("starlight/assets/provenance.yaml")!.getData().toString("utf8");
    zip.updateFile("starlight/assets/provenance.yaml", Buffer.from(`${provenance}  "assets/removed.svg":\n    source: fixture\n    license: test-only\n`));
    const preview = previewScriptImportFromZip(zip.toBuffer(), {
      sourceName: "stale-record.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(preview.assetProvenance.extraFiles).toEqual(["assets/removed.svg"]);
    expect(preview.warnings).toEqual(expect.arrayContaining([expect.stringContaining("missing asset")]));
    expect(preview.errors).toEqual([]);
  });

  it("expires staged authority and supports explicit deletion without removing saves", () => {
    const preview = previewScriptImportFromZip(starlightZip(), {
      sourceName: "starlight.zip",
      scriptsRoot,
      stagingRoot,
      now: 100,
      ttlMs: 10,
    });
    expect(() => commitScriptImport(preview.token, { replace: false, scriptsRoot, stagingRoot, now: 111 }))
      .toThrow(/expired/);

    const fresh = previewScriptImportFromZip(starlightZip(), { sourceName: "starlight.zip", scriptsRoot, stagingRoot });
    commitScriptImport(fresh.token, { replace: false, scriptsRoot, stagingRoot });
    removeInstalledScript("starlight", { scriptsRoot });
    expect(existsSync(path.join(scriptsRoot, "starlight"))).toBe(false);
  });
});
