// YAML loader for script directories: safe parsing (no alias expansion),
// per-file document retention for line-numbered error reporting.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Alias, LineCounter, parseDocument, type Document, type Node } from "yaml";

export interface LoadedYamlFile {
  /** Path relative to the script root, e.g. "npcs/elara.yaml". */
  relPath: string;
  absPath: string;
  text: string;
  doc: Document.Parsed;
  lineCounter: LineCounter;
}

/** Returns a line number (1-based) for a byte offset within a file, or undefined. */
function lineForOffset(doc: LoadedYamlFile, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  const pos = doc.lineCounter.linePos(offset);
  return pos ? pos.line : undefined;
}

function containsAlias(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  if (node instanceof Alias) return true;
  const n = node as Record<string, unknown>;
  if (n.key !== undefined && containsAlias(n.key)) return true;
  if (n.value !== undefined && containsAlias(n.value)) return true;
  if (Array.isArray(n.items)) {
    for (const item of n.items) {
      if (containsAlias(item)) return true;
    }
  }
  return false;
}

/** Loads and parses every .yaml/.yml file under a directory (non-recursive). */
export function loadYamlFilesFromDir(
  absDir: string,
  relPrefix: string,
  maxBytes = 200 * 1024,
): LoadedYamlFile[] {
  if (!statSync(absDir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out: LoadedYamlFile[] = [];
  for (const entry of readdirSync(absDir)) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    const absPath = path.join(absDir, entry);
    const stat = statSync(absPath);
    if (!stat.isFile()) continue;
    if (stat.size > maxBytes) {
      throw new Error(`file exceeds size limit (${maxBytes} bytes): ${absPath}`);
    }
    const text = readFileSync(absPath, "utf8");
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter, strict: true });
    if (doc.errors.length > 0) {
      throw new Error(
        `YAML parse error in ${relPrefix}/${entry}: ${doc.errors
          .map((e) => e.message)
          .join("; ")}`,
      );
    }
    if (containsAlias(doc.contents)) {
      throw new Error(`YAML aliases/anchors are forbidden (security): ${relPrefix}/${entry}`);
    }
    out.push({
      relPath: `${relPrefix}/${entry}`,
      absPath,
      text,
      doc,
      lineCounter,
    });
  }
  return out;
}

/** Resolves a dotted path (zod error path) to a YAML node for line reporting. */
export function lineForPath(file: LoadedYamlFile, pathSegments: Array<string | number>): number | undefined {
  try {
    const node = file.doc.getIn(pathSegments, true) as Node | undefined;
    if (node && typeof node === "object" && "range" in node) {
      const range = (node as { range?: [number, number, number] }).range;
      return lineForOffset(file, range?.[0]);
    }
  } catch {
    // getIn may throw on invalid paths; fall back to undefined.
  }
  return undefined;
}

/** Loads a single YAML file (used for root module files). */
export function loadYamlFile(absPath: string, relPath: string, maxBytes = 200 * 1024): LoadedYamlFile {
  const stat = statSync(absPath);
  if (stat.size > maxBytes) {
    throw new Error(`file exceeds size limit (${maxBytes} bytes): ${absPath}`);
  }
  const text = readFileSync(absPath, "utf8");
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, strict: true });
  if (doc.errors.length > 0) {
    throw new Error(
      `YAML parse error in ${relPath}: ${doc.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (containsAlias(doc.contents)) {
    throw new Error(`YAML aliases/anchors are forbidden (security): ${relPath}`);
  }
  return { relPath, absPath, text, doc, lineCounter };
}
