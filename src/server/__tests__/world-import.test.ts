import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import { importWorldArchive, WorldImportError } from "../world-import";

const fixture = path.resolve("test/fixtures/open-world-script");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function zipDirectory(directory: string, prefix = "world"): AdmZip {
  const zip = new AdmZip();
  const walk = (current: string, relative: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const nextRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(absolute, nextRelative);
      else zip.addFile(path.posix.join(prefix, nextRelative), readFileSync(absolute));
    }
  };
  walk(directory, "");
  return zip;
}

function scriptsRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "chatgame-import-test-"));
  temporaryRoots.push(root);
  return root;
}

function traversalArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile("aa/outside.txt", Buffer.from("no"));
  const buffer = zip.toBuffer();
  const safeName = Buffer.from("aa/outside.txt");
  const unsafeName = Buffer.from("../outside.txt");
  for (let offset = 0; offset <= buffer.length - safeName.length; offset += 1) {
    if (buffer.subarray(offset, offset + safeName.length).equals(safeName)) {
      unsafeName.copy(buffer, offset);
    }
  }
  return buffer;
}

describe("world import", () => {
  it("atomically imports one validated schema v2 world", () => {
    const root = scriptsRoot();
    const result = importWorldArchive(zipDirectory(fixture).toBuffer(), root);

    expect(result).toMatchObject({ id: "open-world-fixture", replaced: false });
    expect(loadWorldScript(path.join(root, result.id)).id).toBe("open-world-fixture");
  });

  it("rejects legacy action files instead of silently ignoring them", () => {
    const zip = zipDirectory(fixture);
    zip.addFile("world/actions.yaml", Buffer.from("actions: []\n"));

    expect(() => importWorldArchive(zip.toBuffer(), scriptsRoot())).toThrow("unexpected world script file");
  });

  it("rejects traversal entries", () => {
    expect(() => importWorldArchive(traversalArchive(), scriptsRoot())).toThrow(WorldImportError);
  });

  it("requires explicit replacement for an existing world", () => {
    const root = scriptsRoot();
    const archive = zipDirectory(fixture).toBuffer();
    importWorldArchive(archive, root);

    expect(() => importWorldArchive(archive, root)).toThrow("already exists");
    expect(importWorldArchive(archive, root, true).replaced).toBe(true);
  });
});
