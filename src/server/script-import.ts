// Script import core: the single import logic shared by the EngineHost
// (web upload) and the CLI (scripts/import-script.ts). No dual paths.
//
// Pipeline: zip/dir -> temp staging -> find script.yaml -> parse id ->
// move to scriptsRoot/<id> -> validateScriptDir gate -> result.
// Security: zip-slip entries (absolute paths / ".." segments) are rejected
// before extraction; the target directory name is forced to the script id.
import {
  mkdirSync,
  rmSync,
  existsSync,
  renameSync,
  cpSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parseDocument } from "yaml";
import { validateScriptDir, type ValidationIssue } from "../script/validate";
import { scriptSchema } from "../script/schemas";

export class ScriptImportError extends Error {
  /** Validation issues (present when the script content itself failed). */
  readonly issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "ScriptImportError";
    this.issues = issues;
  }
}

/** Default scripts root (relative to the repo). */
export function defaultScriptsRoot(): string {
  return path.resolve(process.cwd(), "scripts");
}

/** Staging root for import (cleaned per import; kept under .chatgame). */
function stagingRoot(): string {
  return path.join(".chatgame", "import-tmp");
}

/** True when the entry name could escape the extraction root (zip slip). */
function isUnsafeEntry(name: string): boolean {
  if (name.startsWith("/") || name.includes("\\")) return true;
  const segments = name.split("/");
  return segments.includes("..") || segments.includes("");
}

/** Walks up to 2 levels to find script.yaml inside an extracted tree. */
function findScriptDir(root: string): string | null {
  const direct = path.join(root, "script.yaml");
  if (existsSync(direct)) return root; // flat layout
  for (const entry of readdirSync(root)) {
    const child = path.join(root, entry);
    if (!statSync(child, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (existsSync(path.join(child, "script.yaml"))) return child;
  }
  return null;
}

/** Extracts a zip buffer into `target`, rejecting zip-slip entries. */
function extractZip(zipBuffer: Buffer, target: string): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new ScriptImportError("invalid zip file");
  }
  const entries = zip.getEntries();
  if (entries.length === 0) throw new ScriptImportError("zip file is empty");
  mkdirSync(target, { recursive: true });
  const rootAbs = path.resolve(target);
  for (const entry of entries) {
    const name = entry.entryName;
    if (entry.isDirectory) continue;
    if (isUnsafeEntry(name)) {
      throw new ScriptImportError(`unsafe entry in zip: "${name}"`);
    }
    const abs = path.resolve(target, name);
    if (!abs.startsWith(rootAbs + path.sep) && abs !== rootAbs) {
      throw new ScriptImportError(`entry escapes the target directory: "${name}"`);
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, entry.getData());
  }
}

/** Moves the staged script dir into scriptsRoot/<id> (validates id first). */
function stageToLibrary(
  stagedDir: string,
  scriptsRoot: string,
  replace: boolean,
): { scriptId: string; warnings: ValidationIssue[] } {
  // Parse the id before the directory name matters (zip dirs are random).
  let scriptId: string;
  try {
    const parsed = scriptSchema.parse(
      parseDocument(readFileSync(path.join(stagedDir, "script.yaml"), "utf8")).toJS(),
    );
    scriptId = parsed.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ScriptImportError(`script.yaml is invalid: ${message}`);
  }

  const target = path.join(scriptsRoot, scriptId);
  if (existsSync(target)) {
    if (!replace) {
      throw new ScriptImportError(`script "${scriptId}" already exists (use replace to overwrite)`);
    }
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(scriptsRoot, { recursive: true });
  renameSync(stagedDir, target);

  // Validation gate: the staged content must be a complete valid script.
  const validation = validateScriptDir(target);
  if (!validation.ok) {
    // Roll back the import — the library stays clean.
    rmSync(target, { recursive: true, force: true });
    throw new ScriptImportError(
      `script "${scriptId}" failed validation (${validation.issues.length} issue(s))`,
      validation.issues,
    );
  }
  return { scriptId, warnings: validation.issues.filter((i) => i.severity === "warning") };
}

/**
 * Imports a script from a zip buffer (web upload path).
 * `replace: true` overwrites an existing script of the same id.
 */
export function importScriptFromZip(
  zipBuffer: Buffer,
  options: { scriptsRoot?: string; replace?: boolean } = {},
): { scriptId: string; warnings: ValidationIssue[] } {
  const scriptsRoot = options.scriptsRoot ?? defaultScriptsRoot();
  const staging = path.join(stagingRoot(), `zip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    extractZip(zipBuffer, staging);
    const scriptDir = findScriptDir(staging);
    if (!scriptDir) throw new ScriptImportError("zip contains no script.yaml");
    return stageToLibrary(scriptDir, scriptsRoot, options.replace ?? false);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Imports a script from a local directory (CLI path).
 * The directory must be named exactly like its script id.
 */
export function importScriptFromDir(
  srcDir: string,
  options: { scriptsRoot?: string; replace?: boolean } = {},
): { scriptId: string; warnings: ValidationIssue[] } {
  const abs = path.resolve(srcDir);
  if (!existsSync(path.join(abs, "script.yaml"))) {
    throw new ScriptImportError(`directory "${srcDir}" contains no script.yaml`);
  }
  const dirName = path.basename(abs);
  const scriptsRoot = options.scriptsRoot ?? defaultScriptsRoot();
  const staging = path.join(stagingRoot(), `dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    mkdirSync(staging, { recursive: true });
    const staged = path.join(staging, dirName);
    cpSync(abs, staged, { recursive: true });
    return stageToLibrary(staged, scriptsRoot, options.replace ?? false);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
