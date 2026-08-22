import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
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
import {
  copyCoreTestScript,
  coreTestScriptZip,
  TEST_SCRIPT_ID,
} from "./fixtures/core-script";

let root: string;
let scriptsRoot: string;
let stagingRoot: string;
let fixtureSource: string;

beforeEach(() => {
  root = path.join(tmpdir(), `cg-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  scriptsRoot = path.join(root, "scripts");
  stagingRoot = path.join(root, "staging");
  fixtureSource = path.join(root, "fixture-source");
  mkdirSync(scriptsRoot, { recursive: true });
  copyCoreTestScript(fixtureSource);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixtureZip(options: { provenance?: boolean } = { provenance: true }): Buffer {
  return coreTestScriptZip(fixtureSource, TEST_SCRIPT_ID, options);
}

describe("two-stage script import", () => {
  it("previews schema, APIs, cover, permissions and then commits", () => {
    const preview = previewScriptImportFromZip(fixtureZip(), {
      sourceName: "trusted-core-fixture.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(preview).toMatchObject({
      scriptId: TEST_SCRIPT_ID,
      schemaVersion: "1.1",
      apiVersions: { hostUi: 6, engine: 2, scriptUi: 6 },
      conflicts: { installed: false, replaceAllowed: false },
      errors: [],
    });
    expect(preview.cover?.file).toBe("assets/backgrounds/test-stage.svg");
    expect(preview.coverUrl).toBe(`/api/scripts/import/preview/${preview.token}/cover`);
    expect(readImportPreviewCover(preview.token, { stagingRoot }).mimeType).toBe("image/svg+xml");
    expect(preview.permissions).toEqual(expect.arrayContaining(["engine", "ui", "assets"]));
    expect(preview.assetProvenance).toMatchObject({ manifestPresent: true, coveredFiles: preview.assetProvenance.totalFiles, missingFiles: [] });

    expect(commitScriptImport(preview.token, { replace: false, scriptsRoot, stagingRoot })).toMatchObject({ scriptId: TEST_SCRIPT_ID });
    expect(scriptInstallSource(path.join(scriptsRoot, TEST_SCRIPT_ID))).toEqual({ kind: "imported", label: "trusted-core-fixture.zip" });
  });

  it("requires an explicit replace confirmation for conflicts", () => {
    const first = previewScriptImportFromZip(fixtureZip(), { sourceName: "first.zip", scriptsRoot, stagingRoot });
    commitScriptImport(first.token, { replace: false, scriptsRoot, stagingRoot });
    const conflict = previewScriptImportFromZip(fixtureZip(), { sourceName: "second.zip", scriptsRoot, stagingRoot });
    expect(conflict.conflicts.installed).toBe(true);
    expect(conflict.conflicts.replaceAllowed).toBe(true);
    expect(() => commitScriptImport(conflict.token, { replace: false, scriptsRoot, stagingRoot }))
      .toThrow(/confirm replacement/);

    const confirmed = previewScriptImportFromZip(fixtureZip(), { sourceName: "second.zip", scriptsRoot, stagingRoot });
    expect(() => commitScriptImport(confirmed.token, { replace: true, scriptsRoot, stagingRoot })).not.toThrow();
  });

  it("does not let a conflict-free preview replace a script installed later", () => {
    const stale = previewScriptImportFromZip(fixtureZip(), { sourceName: "stale.zip", scriptsRoot, stagingRoot });
    const winner = previewScriptImportFromZip(fixtureZip(), { sourceName: "winner.zip", scriptsRoot, stagingRoot });
    commitScriptImport(winner.token, { replace: false, scriptsRoot, stagingRoot });

    expect(() => commitScriptImport(stale.token, { replace: true, scriptsRoot, stagingRoot }))
      .toThrow(/changed after preview/);
    expect(scriptInstallSource(path.join(scriptsRoot, TEST_SCRIPT_ID))).toEqual({ kind: "imported", label: "winner.zip" });
  });

  it("does not let a stale replacement preview overwrite a newer replacement", () => {
    const initial = previewScriptImportFromZip(fixtureZip(), { sourceName: "initial.zip", scriptsRoot, stagingRoot });
    commitScriptImport(initial.token, { replace: false, scriptsRoot, stagingRoot });
    const stale = previewScriptImportFromZip(fixtureZip(), { sourceName: "stale.zip", scriptsRoot, stagingRoot });
    const winner = previewScriptImportFromZip(fixtureZip(), { sourceName: "winner.zip", scriptsRoot, stagingRoot });

    commitScriptImport(winner.token, { replace: true, scriptsRoot, stagingRoot });
    expect(() => commitScriptImport(stale.token, { replace: true, scriptsRoot, stagingRoot }))
      .toThrow(expect.objectContaining({ status: 409 }));
    expect(scriptInstallSource(path.join(scriptsRoot, TEST_SCRIPT_ID)))
      .toEqual({ kind: "imported", label: "winner.zip" });
    expect(() => commitScriptImport(stale.token, { replace: true, scriptsRoot, stagingRoot }))
      .toThrow(expect.objectContaining({ status: 404 }));
  });

  it("invalidates a replacement preview after deleting and reinstalling the same package", () => {
    const initial = previewScriptImportFromZip(fixtureZip(), { sourceName: "same.zip", scriptsRoot, stagingRoot });
    commitScriptImport(initial.token, { replace: false, scriptsRoot, stagingRoot });
    const stale = previewScriptImportFromZip(fixtureZip(), { sourceName: "stale.zip", scriptsRoot, stagingRoot });

    removeInstalledScript(TEST_SCRIPT_ID, { scriptsRoot });
    const reinstalled = previewScriptImportFromZip(fixtureZip(), { sourceName: "same.zip", scriptsRoot, stagingRoot });
    commitScriptImport(reinstalled.token, { replace: false, scriptsRoot, stagingRoot });

    expect(() => commitScriptImport(stale.token, { replace: true, scriptsRoot, stagingRoot }))
      .toThrow(expect.objectContaining({ status: 409 }));
    expect(scriptInstallSource(path.join(scriptsRoot, TEST_SCRIPT_ID)))
      .toEqual({ kind: "imported", label: "same.zip" });
  });

  it("invalidates a replacement preview when installed content changes in place", () => {
    const initial = previewScriptImportFromZip(fixtureZip(), { sourceName: "initial.zip", scriptsRoot, stagingRoot });
    commitScriptImport(initial.token, { replace: false, scriptsRoot, stagingRoot });
    const stale = previewScriptImportFromZip(fixtureZip(), { sourceName: "stale.zip", scriptsRoot, stagingRoot });
    const installedScript = path.join(scriptsRoot, TEST_SCRIPT_ID, "script.yaml");

    appendFileSync(installedScript, "\n# operator edit\n");

    expect(() => commitScriptImport(stale.token, { replace: true, scriptsRoot, stagingRoot }))
      .toThrow(expect.objectContaining({ status: 409 }));
    expect(statSync(installedScript).size).toBeGreaterThan(statSync(path.join(fixtureSource, "script.yaml")).size);
  });

  it("never replaces or deletes a built-in script", () => {
    const builtIn = path.join(scriptsRoot, TEST_SCRIPT_ID);
    mkdirSync(builtIn, { recursive: true });
    const sourceScript = path.join(fixtureSource, "script.yaml");
    const original = statSync(sourceScript).size;
    const zip = fixtureZip();
    // A directory without an installation receipt is owned by the application.
    const unpacked = new AdmZip(zip);
    unpacked.extractAllTo(scriptsRoot, true);
    const preview = previewScriptImportFromZip(zip, { sourceName: "replacement.zip", scriptsRoot, stagingRoot });
    expect(preview.conflicts).toEqual({ installed: true, replaceAllowed: false });
    expect(preview.errors).toEqual(expect.arrayContaining([expect.stringContaining("cannot be replaced")]));
    expect(() => commitScriptImport(preview.token, { replace: true, scriptsRoot, stagingRoot })).toThrow(/validation errors/);
    expect(statSync(path.join(builtIn, "script.yaml")).size).toBe(original);
    expect(() => removeInstalledScript(TEST_SCRIPT_ID, { scriptsRoot })).toThrow(/cannot be deleted/);
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
    const missing = previewScriptImportFromZip(fixtureZip({ provenance: false }), {
      sourceName: "unattributed.zip",
      scriptsRoot,
      stagingRoot,
    });
    expect(missing.assetProvenance.manifestPresent).toBe(false);
    expect(missing.assetProvenance.missingFiles.length).toBeGreaterThan(0);
    expect(missing.errors).toEqual(expect.arrayContaining([expect.stringContaining("provenance.yaml")]));

    const zip = new AdmZip(fixtureZip());
    const manifestEntry = `${TEST_SCRIPT_ID}/assets.yaml`;
    const manifest = zip.getEntry(manifestEntry)!.getData().toString("utf8");
    zip.updateFile(manifestEntry, Buffer.from(manifest.replace(
      "assets/backgrounds/test-stage.svg",
      "https://cdn.example.invalid/test-stage.svg",
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
    const zip = new AdmZip(fixtureZip());
    const provenanceEntry = `${TEST_SCRIPT_ID}/assets/provenance.yaml`;
    const provenance = zip.getEntry(provenanceEntry)!.getData().toString("utf8");
    zip.updateFile(provenanceEntry, Buffer.from(`${provenance}  "assets/removed.svg":\n    source: fixture\n    license: test-only\n`));
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
    const preview = previewScriptImportFromZip(fixtureZip(), {
      sourceName: "core-fixture.zip",
      scriptsRoot,
      stagingRoot,
      now: 100,
      ttlMs: 10,
    });
    expect(() => commitScriptImport(preview.token, { replace: false, scriptsRoot, stagingRoot, now: 111 }))
      .toThrow(/expired/);

    const fresh = previewScriptImportFromZip(fixtureZip(), { sourceName: "core-fixture.zip", scriptsRoot, stagingRoot });
    commitScriptImport(fresh.token, { replace: false, scriptsRoot, stagingRoot });
    removeInstalledScript(TEST_SCRIPT_ID, { scriptsRoot });
    expect(existsSync(path.join(scriptsRoot, TEST_SCRIPT_ID))).toBe(false);
  });
});
