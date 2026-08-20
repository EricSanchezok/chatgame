// Script import core shared by the web two-stage flow and the CLI. Preview
// performs extraction and static validation only; commit is the only step
// allowed to mutate the installed library.
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parseDocument } from "yaml";
import { validateScriptDir, type ValidationIssue } from "../script/validate";
import { scriptSchema } from "../script/schemas";
import type { ImportPreview, ImportRisk } from "../shared/client-dto";
import { SCRIPT_UI_API_VERSION } from "../shared/client-dto";

export const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
export const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;
const INSTALL_SOURCE_FILE = ".chatgame-source.json";
const PREVIEW_IMAGE_MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export class ScriptImportError extends Error {
  readonly issues: ValidationIssue[];
  readonly status: number;

  constructor(message: string, issues: ValidationIssue[] = [], status = 400) {
    super(message);
    this.name = "ScriptImportError";
    this.issues = issues;
    this.status = status;
  }
}

export function defaultScriptsRoot(): string {
  return path.resolve(process.cwd(), "scripts");
}

export function importPreviewRoot(): string {
  return path.resolve(".chatgame", "import-staging");
}

function importTempRoot(): string {
  return path.resolve(".chatgame", "import-tmp");
}

function pruneEmptyRoot(root: string): void {
  try {
    rmdirSync(root);
  } catch {
    // Concurrent work or an absent directory is expected.
  }
}

function isUnsafeEntry(name: string): boolean {
  if (name.startsWith("/") || name.includes("\\")) return true;
  const segments = name.split("/");
  return segments.includes("..") || segments.includes("");
}

function findScriptDir(root: string): string | null {
  if (existsSync(path.join(root, "script.yaml"))) return root;
  for (const entry of readdirSync(root)) {
    const child = path.join(root, entry);
    if (!statSync(child, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (existsSync(path.join(child, "script.yaml"))) return child;
  }
  return null;
}

function extractZip(zipBuffer: Buffer, target: string, maxUnpackedBytes: number): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new ScriptImportError("invalid zip file");
  }
  const entries = zip.getEntries();
  if (entries.length === 0) throw new ScriptImportError("zip file is empty");
  mkdirSync(target, { recursive: true });
  let unpackedBytes = 0;
  const rootAbs = path.resolve(target);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (isUnsafeEntry(name)) throw new ScriptImportError(`unsafe entry in zip: "${name}"`);
    const absolute = path.resolve(target, name);
    if (!absolute.startsWith(`${rootAbs}${path.sep}`)) {
      throw new ScriptImportError(`entry escapes the target directory: "${name}"`);
    }
    const data = entry.getData();
    unpackedBytes += data.byteLength;
    if (unpackedBytes > maxUnpackedBytes) {
      throw new ScriptImportError(`archive unpacks too large (limit: ${maxUnpackedBytes} bytes)`);
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, data);
  }
}

function parseScriptIdentity(scriptDir: string): { id: string; name: string } {
  try {
    const parsed = scriptSchema.parse(
      parseDocument(readFileSync(path.join(scriptDir, "script.yaml"), "utf8")).toJS(),
    );
    return { id: parsed.id, name: parsed.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScriptImportError(`script.yaml is invalid: ${message}`);
  }
}

function validationIssues(scriptDir: string): ValidationIssue[] {
  const validation = validateScriptDir(scriptDir);
  return validation.issues;
}

function walkAssetFiles(dir: string, base = "assets"): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const relative = `${base}/${entry}`;
    if (statSync(absolute).isDirectory()) files.push(...walkAssetFiles(absolute, relative));
    else if (relative !== "assets/provenance.yaml") files.push(relative);
  }
  return files.sort();
}

function remoteFileReferences(scriptDir: string): string[] {
  const manifests = [path.join(scriptDir, "assets.yaml"), path.join(scriptDir, "theme.yaml")];
  const themesDir = path.join(scriptDir, "themes");
  if (existsSync(themesDir)) {
    for (const entry of readdirSync(themesDir)) {
      if (/\.ya?ml$/i.test(entry)) manifests.push(path.join(themesDir, entry));
    }
  }
  const found = new Set<string>();
  const visit = (value: unknown, keyPath: string): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      if (key === "file" && typeof child === "string" && /^(?:https?:)?\/\//i.test(child)) {
        found.add(`${nextPath}: ${child}`);
      } else {
        visit(child, nextPath);
      }
    }
  };
  for (const manifest of manifests) {
    if (!existsSync(/* turbopackIgnore: true */ manifest)) continue;
    try {
      visit(parseDocument(readFileSync(/* turbopackIgnore: true */ manifest, "utf8")).toJS(), path.relative(scriptDir, manifest));
    } catch {
      // The ordinary script validator reports malformed YAML.
    }
  }
  return [...found].sort();
}

function inspectAssetProvenance(scriptDir: string): {
  summary: ImportPreview["assetProvenance"];
  issues: ValidationIssue[];
} {
  const assetFiles = walkAssetFiles(path.join(scriptDir, "assets"));
  const manifestPath = path.join(scriptDir, "assets", "provenance.yaml");
  const remoteReferences = remoteFileReferences(scriptDir);
  const issues: ValidationIssue[] = remoteReferences.map((reference) => ({
    file: reference.split(":", 1)[0] ?? "assets.yaml",
    path: "file",
    message: `remote asset hotlink is forbidden (${reference})`,
  }));
  let files: Record<string, unknown> = {};
  if (existsSync(manifestPath)) {
    try {
      const parsed = parseDocument(readFileSync(manifestPath, "utf8")).toJS() as { files?: unknown } | null;
      if (!parsed || typeof parsed !== "object" || !parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)) {
        issues.push({ file: "assets/provenance.yaml", path: "files", message: "files must be a mapping keyed by asset path" });
      } else {
        files = parsed.files as Record<string, unknown>;
      }
    } catch (error) {
      issues.push({
        file: "assets/provenance.yaml",
        path: "",
        message: `invalid provenance YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else if (assetFiles.length > 0) {
    issues.push({
      file: "assets/provenance.yaml",
      path: "",
      message: "asset files require an assets/provenance.yaml manifest",
    });
  }

  const missingFiles = assetFiles.filter((file) => !(file in files));
  const extraFiles = Object.keys(files).filter((file) => !assetFiles.includes(file)).sort();
  for (const file of missingFiles) {
    issues.push({ file: "assets/provenance.yaml", path: `files.${file}`, message: `asset has no provenance record: ${file}` });
  }
  for (const [file, entry] of Object.entries(files)) {
    if (!assetFiles.includes(file)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({ file: "assets/provenance.yaml", path: `files.${file}`, message: "provenance record must be a mapping" });
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.source !== "string" || !record.source.trim()) {
      issues.push({ file: "assets/provenance.yaml", path: `files.${file}.source`, message: "source is required" });
    }
    if (typeof record.license !== "string" || !record.license.trim()) {
      issues.push({ file: "assets/provenance.yaml", path: `files.${file}.license`, message: "license is required" });
    }
  }
  for (const file of extraFiles) {
    issues.push({
      file: "assets/provenance.yaml",
      path: `files.${file}`,
      message: `provenance record points to a missing asset: ${file}`,
      severity: "warning",
    });
  }
  return {
    summary: {
      manifestPresent: existsSync(manifestPath),
      coveredFiles: assetFiles.length - missingFiles.length,
      totalFiles: assetFiles.length,
      missingFiles,
      extraFiles,
      remoteReferences,
    },
    issues,
  };
}

function validateStaged(scriptDir: string): ValidationIssue[] {
  const issues = [...validationIssues(scriptDir), ...inspectAssetProvenance(scriptDir).issues];
  const errors = issues.filter((issue) => issue.severity !== "warning");
  if (errors.length > 0) {
    throw new ScriptImportError(`script failed validation (${errors.length} error(s))`, issues);
  }
  return issues.filter((issue) => issue.severity === "warning");
}

function issueText(issue: ValidationIssue): string {
  return `${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`;
}

function loosePreviewMetadata(scriptDir: string): Pick<ImportPreview, "scriptId" | "name" | "schemaVersion" | "apiVersions" | "cover"> {
  let raw: Record<string, unknown> = {};
  try {
    const value = parseDocument(readFileSync(path.join(scriptDir, "script.yaml"), "utf8")).toJS();
    if (value && typeof value === "object") raw = value as Record<string, unknown>;
  } catch {
    // Validation reports the parse failure; the preview remains inspectable.
  }
  const extension = raw.engine_extension && typeof raw.engine_extension === "object"
    ? raw.engine_extension as Record<string, unknown>
    : {};
  let scriptUi: number | null = null;
  for (const entry of [path.join(scriptDir, "ui", "index.ts"), path.join(scriptDir, "ui", "index.tsx")]) {
    if (!existsSync(/* turbopackIgnore: true */ entry)) continue;
    const source = readFileSync(/* turbopackIgnore: true */ entry, "utf8");
    const literal = source.match(/export\s+const\s+apiVersion\s*=\s*(\d+)/)?.[1];
    scriptUi = literal ? Number(literal) : source.includes("SCRIPT_UI_API_VERSION") ? SCRIPT_UI_API_VERSION : null;
    break;
  }
  let cover: ImportPreview["cover"];
  try {
    const assets = parseDocument(readFileSync(path.join(scriptDir, "assets.yaml"), "utf8")).toJS() as { cover?: unknown };
    if (assets.cover && typeof assets.cover === "object") cover = assets.cover as ImportPreview["cover"];
  } catch {
    // Assets validation owns malformed cover details.
  }
  return {
    scriptId: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "未命名剧本",
    schemaVersion: typeof raw.schema_version === "string" ? raw.schema_version : null,
    apiVersions: {
      hostUi: SCRIPT_UI_API_VERSION,
      engine: typeof extension.api_version === "number" ? extension.api_version : null,
      scriptUi,
    },
    cover,
  };
}

function detectPermissions(scriptDir: string): ImportPreview["permissions"] {
  const permissions: ImportPreview["permissions"] = [];
  if (existsSync(path.join(scriptDir, "engine", "index.ts"))) permissions.push("engine");
  if (
    existsSync(path.join(scriptDir, "ui", "index.ts")) ||
    existsSync(path.join(scriptDir, "ui", "index.tsx"))
  ) permissions.push("ui");
  if (existsSync(path.join(scriptDir, "assets.yaml")) || existsSync(path.join(scriptDir, "assets"))) {
    permissions.push("assets");
  }
  return permissions;
}

function risksFor(
  permissions: ImportPreview["permissions"],
  installed: boolean,
): ImportRisk[] {
  const risks: ImportRisk[] = [];
  if (permissions.includes("engine")) {
    risks.push({
      code: "engine-code",
      label: "包含引擎代码",
      detail: "安装后，该剧本的服务端扩展与宿主进程同权运行。只安装你信任来源的剧本。",
    });
  }
  if (permissions.includes("ui")) {
    risks.push({
      code: "ui-code",
      label: "包含界面代码",
      detail: "进入剧本后，该界面扩展会在浏览器中运行，但网络与会话能力仍由宿主持有。",
    });
  }
  if (installed) {
    risks.push({
      code: "replace",
      label: "将替换已安装剧本",
      detail: "同名剧本目录会被完整替换；存档保留，但可能与新内容不兼容。",
    });
  }
  return risks;
}

interface PreviewRecord extends ImportPreview {
  contentDirName: string;
  createdAt: number;
  expiresAt: number;
  targetIdentity: string;
}

export function scriptInstallSource(scriptDir: string): ScriptSummarySource {
  try {
    const parsed = JSON.parse(readFileSync(path.join(scriptDir, INSTALL_SOURCE_FILE), "utf8")) as { label?: unknown };
    if (typeof parsed.label === "string" && parsed.label) return { kind: "imported", label: parsed.label };
  } catch {
    // No installation receipt means the script is part of the bundled library.
  }
  return { kind: "built-in", label: "内置" };
}

type ScriptSummarySource = { kind: "built-in" | "imported"; label: string };

function installedTargetIdentity(target: string): string {
  if (!existsSync(/* turbopackIgnore: true */ target)) return "absent";

  const hash = createHash("sha256");
  const updateEntry = (kind: string, relative: string): void => {
    hash.update(`${kind}:${Buffer.byteLength(relative)}:${relative}:`);
  };
  const visit = (dir: string, relativeDir: string): void => {
    const entries = readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolute = path.join(/* turbopackIgnore: true */ dir, entry.name);
      if (entry.isDirectory()) {
        updateEntry("directory", relative);
        visit(absolute, relative);
      } else if (entry.isFile()) {
        const data = readFileSync(/* turbopackIgnore: true */ absolute);
        updateEntry("file", relative);
        hash.update(`${data.byteLength}:`);
        hash.update(data);
      } else if (entry.isSymbolicLink()) {
        const link = readlinkSync(/* turbopackIgnore: true */ absolute);
        updateEntry("symlink", relative);
        hash.update(`${Buffer.byteLength(link)}:${link}`);
      } else {
        updateEntry("other", relative);
      }
    }
  };

  visit(target, "");
  return `installed:${hash.digest("hex")}`;
}

function previewRecordPath(root: string, token: string): string {
  return path.join(root, token, "preview.json");
}

function assertToken(token: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new ScriptImportError("invalid import preview token");
}

export function cleanupExpiredImportPreviews(options: {
  stagingRoot?: string;
  now?: number;
} = {}): number {
  const root = options.stagingRoot ?? importPreviewRoot();
  const now = options.now ?? Date.now();
  if (!existsSync(/* turbopackIgnore: true */ root)) return 0;
  let removed = 0;
  for (const token of readdirSync(/* turbopackIgnore: true */ root)) {
    const dir = path.join(/* turbopackIgnore: true */ root, token);
    if (!statSync(/* turbopackIgnore: true */ dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    try {
      const record = JSON.parse(readFileSync(previewRecordPath(root, token), "utf8")) as PreviewRecord;
      if (record.expiresAt > now) continue;
    } catch {
      // Incomplete/crashed previews have no reusable authority and are stale.
    }
    rmSync(dir, { recursive: true, force: true });
    removed += 1;
  }
  pruneEmptyRoot(root);
  return removed;
}

export function previewScriptImportFromZip(
  zipBuffer: Buffer,
  options: {
    sourceName: string;
    scriptsRoot?: string;
    stagingRoot?: string;
    now?: number;
    ttlMs?: number;
    maxUnpackedBytes?: number;
  },
): ImportPreview {
  const scriptsRoot = options.scriptsRoot ?? defaultScriptsRoot();
  const root = options.stagingRoot ?? importPreviewRoot();
  const now = options.now ?? Date.now();
  cleanupExpiredImportPreviews({ stagingRoot: root, now });
  const token = randomUUID();
  const previewDir = path.join(/* turbopackIgnore: true */ root, token);
  const extracted = path.join(previewDir, "extracted");
  try {
    extractZip(zipBuffer, extracted, options.maxUnpackedBytes ?? MAX_UNPACKED_BYTES);
    const found = findScriptDir(extracted);
    if (!found) throw new ScriptImportError("zip contains no script.yaml");
    const initialMetadata = loosePreviewMetadata(found);
    const contentDirName = /^[a-z][a-z0-9-]*$/.test(initialMetadata.scriptId)
      ? initialMetadata.scriptId
      : "invalid-script";
    const content = path.join(/* turbopackIgnore: true */ previewDir, contentDirName);
    renameSync(found, content);
    rmSync(extracted, { recursive: true, force: true });
    const metadata = loosePreviewMetadata(content);
    const provenance = inspectAssetProvenance(content);
    const issues = [...validationIssues(content), ...provenance.issues];
    const errors = issues.filter((issue) => issue.severity !== "warning").map(issueText);
    const warnings = issues.filter((issue) => issue.severity === "warning").map(issueText);
    if (metadata.apiVersions.scriptUi !== null && metadata.apiVersions.scriptUi !== SCRIPT_UI_API_VERSION) {
      errors.push(`ui/index.tsx UI API ${metadata.apiVersions.scriptUi} is incompatible with host UI API ${SCRIPT_UI_API_VERSION}`);
    }
    const permissions = detectPermissions(content);
    const installedDir = metadata.scriptId !== "" ? path.join(/* turbopackIgnore: true */ scriptsRoot, metadata.scriptId) : "";
    const installed = installedDir !== "" && existsSync(installedDir);
    const replaceAllowed = installed && scriptInstallSource(installedDir).kind === "imported";
    const targetIdentity = installedDir === "" ? "absent" : installedTargetIdentity(installedDir);
    if (installed && !replaceAllowed) errors.push(`built-in script "${metadata.scriptId}" cannot be replaced`);
    const record: PreviewRecord = {
      token,
      ...metadata,
      contentDirName,
      sourceName: path.basename(options.sourceName),
      coverUrl: metadata.cover?.file ? `/api/scripts/import/preview/${token}/cover` : undefined,
      conflicts: { installed, replaceAllowed },
      permissions,
      assetProvenance: provenance.summary,
      risks: risksFor(permissions, replaceAllowed),
      errors,
      warnings,
      createdAt: now,
      expiresAt: now + (options.ttlMs ?? IMPORT_PREVIEW_TTL_MS),
      targetIdentity,
    };
    writeFileSync(previewRecordPath(root, token), JSON.stringify(record), "utf8");
    const {
      contentDirName: _contentDirName,
      createdAt: _createdAt,
      expiresAt: _expiresAt,
      targetIdentity: _targetIdentity,
      ...preview
    } = record;
    void _contentDirName;
    void _createdAt;
    void _expiresAt;
    void _targetIdentity;
    return preview;
  } catch (error) {
    rmSync(previewDir, { recursive: true, force: true });
    pruneEmptyRoot(root);
    throw error;
  }
}

export function readImportPreviewCover(
  token: string,
  options: { stagingRoot?: string; now?: number } = {},
): { data: Buffer; mimeType: string } {
  const root = options.stagingRoot ?? importPreviewRoot();
  const record = readPreviewRecord(root, token, options.now ?? Date.now());
  const file = record.cover?.file;
  if (!file || !file.startsWith("assets/") || file.includes("\\") || file.split("/").includes("..")) {
    throw new ScriptImportError("preview cover not found", [], 404);
  }
  const mimeType = PREVIEW_IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mimeType) throw new ScriptImportError("preview cover type is not allowed", [], 415);
  const contentRoot = path.resolve(root, token, record.contentDirName);
  const absolute = path.resolve(contentRoot, file);
  if (!absolute.startsWith(`${contentRoot}${path.sep}`) || !existsSync(/* turbopackIgnore: true */ absolute) || !statSync(/* turbopackIgnore: true */ absolute).isFile()) {
    throw new ScriptImportError("preview cover not found", [], 404);
  }
  const data = readFileSync(/* turbopackIgnore: true */ absolute);
  if (data.byteLength > 5 * 1024 * 1024) throw new ScriptImportError("preview cover is too large", [], 413);
  return { data, mimeType };
}

function readPreviewRecord(root: string, token: string, now: number): PreviewRecord {
  assertToken(token);
  try {
    const record = JSON.parse(readFileSync(previewRecordPath(root, token), "utf8")) as PreviewRecord;
    if (record.token !== token || record.expiresAt <= now) {
      rmSync(path.join(root, token), { recursive: true, force: true });
      pruneEmptyRoot(root);
      throw new ScriptImportError("import preview expired; choose the zip again", [], 410);
    }
    return record;
  } catch (error) {
    if (error instanceof ScriptImportError) throw error;
    throw new ScriptImportError("import preview not found or already used", [], 404);
  }
}

function installStagedScript(
  stagedDir: string,
  scriptsRoot: string,
  replace: boolean,
  sourceLabel: string,
): { scriptId: string; warnings: ValidationIssue[] } {
  const identity = parseScriptIdentity(stagedDir);
  const warnings = validateStaged(stagedDir);
  mkdirSync(scriptsRoot, { recursive: true });
  const target = path.join(scriptsRoot, identity.id);
  if (existsSync(target) && !replace) {
    throw new ScriptImportError(`script "${identity.id}" already exists; confirm replacement to continue`, [], 409);
  }
  if (existsSync(target) && scriptInstallSource(target).kind !== "imported") {
    throw new ScriptImportError(`built-in script "${identity.id}" cannot be replaced`, [], 403);
  }

  const nonce = randomUUID();
  const incoming = path.join(scriptsRoot, `.${identity.id}.incoming-${nonce}`);
  const backup = path.join(scriptsRoot, `.${identity.id}.backup-${nonce}`);
  cpSync(stagedDir, incoming, { recursive: true });
  writeFileSync(
    path.join(incoming, INSTALL_SOURCE_FILE),
    JSON.stringify({ label: sourceLabel, installationId: randomUUID() }),
    "utf8",
  );
  let backedUp = false;
  try {
    if (existsSync(target)) {
      renameSync(target, backup);
      backedUp = true;
    }
    renameSync(incoming, target);
    if (backedUp) rmSync(backup, { recursive: true, force: true });
    return { scriptId: identity.id, warnings };
  } catch (error) {
    rmSync(incoming, { recursive: true, force: true });
    if (backedUp && !existsSync(target) && existsSync(backup)) renameSync(backup, target);
    throw error;
  }
}

export function commitScriptImport(
  token: string,
  options: { replace: boolean; scriptsRoot?: string; stagingRoot?: string; now?: number },
): { scriptId: string; warnings: string[] } {
  const scriptsRoot = options.scriptsRoot ?? defaultScriptsRoot();
  const root = options.stagingRoot ?? importPreviewRoot();
  const record = readPreviewRecord(root, token, options.now ?? Date.now());
  const previewDir = path.join(/* turbopackIgnore: true */ root, token);
  try {
    if (record.errors.length > 0) {
      throw new ScriptImportError("import preview contains validation errors", [], 422);
    }
    const target = record.scriptId ? path.join(/* turbopackIgnore: true */ scriptsRoot, record.scriptId) : "";
    const installed = target !== "" && existsSync(target);
    const replaceAllowed = installed && scriptInstallSource(target).kind === "imported";
    if (
      installedTargetIdentity(target) !== record.targetIdentity ||
      installed !== record.conflicts.installed
      || replaceAllowed !== record.conflicts.replaceAllowed
    ) {
      throw new ScriptImportError("installed script changed after preview; preview the zip again", [], 409);
    }
    if (options.replace && !record.conflicts.replaceAllowed) {
      throw new ScriptImportError("this preview did not authorize replacement; preview the zip again", [], 409);
    }
    const result = installStagedScript(path.join(previewDir, record.contentDirName), scriptsRoot, options.replace, record.sourceName);
    return { scriptId: result.scriptId, warnings: result.warnings.map((warning) => warning.message) };
  } finally {
    rmSync(previewDir, { recursive: true, force: true });
    pruneEmptyRoot(root);
  }
}

/** CLI/direct host path. Web callers must use preview + commit. */
export function importScriptFromZip(
  zipBuffer: Buffer,
  options: { scriptsRoot?: string; replace?: boolean; maxUnpackedBytes?: number } = {},
): { scriptId: string; warnings: ValidationIssue[] } {
  const root = importTempRoot();
  const staging = path.join(root, `zip-${randomUUID()}`);
  try {
    extractZip(zipBuffer, staging, options.maxUnpackedBytes ?? MAX_UNPACKED_BYTES);
    const scriptDir = findScriptDir(staging);
    if (!scriptDir) throw new ScriptImportError("zip contains no script.yaml");
    return installStagedScript(scriptDir, options.scriptsRoot ?? defaultScriptsRoot(), options.replace ?? false, "命令行 zip 导入");
  } finally {
    rmSync(staging, { recursive: true, force: true });
    pruneEmptyRoot(root);
  }
}

export function importScriptFromDir(
  srcDir: string,
  options: { scriptsRoot?: string; replace?: boolean } = {},
): { scriptId: string; warnings: ValidationIssue[] } {
  const absolute = path.resolve(srcDir);
  if (!existsSync(path.join(absolute, "script.yaml"))) {
    throw new ScriptImportError(`directory "${srcDir}" contains no script.yaml`);
  }
  return installStagedScript(absolute, options.scriptsRoot ?? defaultScriptsRoot(), options.replace ?? false, path.basename(absolute));
}

export function removeInstalledScript(
  scriptId: string,
  options: { scriptsRoot?: string } = {},
): void {
  if (!/^[a-z][a-z0-9-]*$/.test(scriptId)) throw new ScriptImportError(`invalid script id "${scriptId}"`);
  const root = path.resolve(/* turbopackIgnore: true */ options.scriptsRoot ?? defaultScriptsRoot());
  const target = path.resolve(root, scriptId);
  if (!target.startsWith(`${root}${path.sep}`) || !existsSync(path.join(target, "script.yaml"))) {
    throw new ScriptImportError(`script "${scriptId}" is not installed`, [], 404);
  }
  if (scriptInstallSource(target).kind !== "imported") {
    throw new ScriptImportError(`built-in script "${scriptId}" cannot be deleted`, [], 403);
  }
  rmSync(target, { recursive: true, force: false });
  rmSync(path.resolve(".chatgame", "build", scriptId), { recursive: true, force: true });
}
