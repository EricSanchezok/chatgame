import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import {
  importWorldArchive,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRY_COUNT,
  MAX_EXPANDED_BYTES,
  WorldImportError,
} from "../world-import";

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

function oversizedDeclaredArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile("world/script.yaml", Buffer.from("small"));
  const buffer = zip.toBuffer();
  for (let offset = 0; offset <= buffer.length - 28; offset += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) buffer.writeUInt32LE(MAX_EXPANDED_BYTES + 1, offset + 22);
    if (signature === 0x02014b50) buffer.writeUInt32LE(MAX_EXPANDED_BYTES + 1, offset + 24);
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

    try {
      importWorldArchive(zip.toBuffer(), scriptsRoot());
      throw new Error("legacy archive unexpectedly imported");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("unexpected world script file");
      expect(message).toContain("<world>");
      expect(message).not.toContain(tmpdir());
    }
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

  it("rejects compressed archives, declared expansion and entry counts above their exact limits", () => {
    expect(() => importWorldArchive(Buffer.alloc(MAX_ARCHIVE_BYTES + 1), scriptsRoot()))
      .toThrow("archive exceeds 50 MiB");
    expect(() => importWorldArchive(oversizedDeclaredArchive(), scriptsRoot()))
      .toThrow("archive expands beyond 100 MiB");

    const zip = new AdmZip();
    for (let index = 0; index <= MAX_ENTRY_COUNT; index += 1) {
      zip.addFile(`world/entities/${index}.yaml`, Buffer.alloc(0));
    }
    expect(() => importWorldArchive(zip.toBuffer(), scriptsRoot())).toThrow("too many entries");
  });

  it("rejects symbolic links and files outside the single world root", () => {
    const linkZip = zipDirectory(fixture);
    linkZip.addFile("world/link", Buffer.from("script.yaml"));
    const link = linkZip.getEntry("world/link");
    if (!link) throw new Error("test archive did not contain link entry");
    link.header.attr = (0o120777 << 16) >>> 0;
    expect(() => importWorldArchive(linkZip.toBuffer(), scriptsRoot())).toThrow("symbolic links");

    const extraZip = zipDirectory(fixture);
    extraZip.addFile("unrelated.txt", Buffer.from("not part of the world"));
    expect(() => importWorldArchive(extraZip.toBuffer(), scriptsRoot())).toThrow("outside its single world root");
  });
});
