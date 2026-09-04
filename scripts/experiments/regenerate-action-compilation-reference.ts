import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalize, contentHash } from "../../src/engine/models/model-audit";
import { assertSafeBenchmarkSource, type RawBenchmarkSource } from "../../src/engine/benchmarks/source-capture";

interface Args { source: string; output: string; version: number; providerModule?: string; dryRun: boolean; force: boolean; }
function required(argv: readonly string[], index: number, option: string): string { const value = argv[index]; if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`); return value; }
function parse(argv: readonly string[]): Args {
  const result: Args = { source: path.resolve(".livingworld-benchmarks/source/action-compilation"), output: path.resolve("benchmarks/action-compilation/fullcatalog-stabilized"), version: 2, dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--source") result.source = path.resolve(required(argv, ++index, argument));
    else if (argument === "--output") result.output = path.resolve(required(argv, ++index, argument));
    else if (argument === "--version") { result.version = Number(required(argv, ++index, argument)); if (!Number.isSafeInteger(result.version) || result.version < 1) throw new Error("--version must be a positive integer"); }
    else if (argument === "--provider-module") result.providerModule = path.resolve(required(argv, ++index, argument));
    else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--force") result.force = true;
    else if (argument === "--help") throw new Error("usage: --source <capture-dir> --output <dataset-root> --version <n> --provider-module <module> [--dry-run] [--force]");
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}
function loadSources(directory: string): RawBenchmarkSource[] {
  const file = path.join(directory, "sources-000.jsonl.gz");
  if (!existsSync(file)) throw new Error(`source shard is missing: ${file}`);
  const text = gunzipSync(readFileSync(file)).toString("utf8");
  return text.split(/\r?\n/u).filter(Boolean).map((line) => {
    const source = JSON.parse(line) as RawBenchmarkSource;
    assertSafeBenchmarkSource(source);
    return source;
  });
}
interface RegeneratorModule {
  regenerateFullReference?: (source: RawBenchmarkSource) => Promise<unknown>;
  default?: (source: RawBenchmarkSource) => Promise<unknown>;
}
export async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try { args = parse(argv); } catch (error) { const message = error instanceof Error ? error.message : String(error); if (message.startsWith("usage:")) { process.stdout.write(`${message}\n`); return 0; } process.stderr.write(`${message}\n`); return 2; }
  try {
    const sources = loadSources(args.source);
    if (args.dryRun) { process.stdout.write(`${JSON.stringify({ source: args.source, records: sources.length, providerRequests: 0, dryRun: true }, null, 2)}\n`); return 0; }
    if (!args.providerModule) throw new Error("--provider-module is required for live FullCatalog regeneration");
    const moduleValue = await import(pathToFileURL(args.providerModule).href) as RegeneratorModule;
    const regenerate = moduleValue.regenerateFullReference ?? moduleValue.default;
    if (typeof regenerate !== "function") throw new Error("provider module must export regenerateFullReference(source) or a default function");
    const references: unknown[] = [];
    for (const source of sources) {
      const reference = await regenerate(source);
      assertSafeBenchmarkSource(reference);
      references.push({ sourceExecutionId: source.sourceExecutionId, sourceInvocationId: source.sourceInvocationId, reference });
    }
    const versionDirectory = path.join(args.output, `v${args.version}`);
    if (!args.force && existsSync(versionDirectory)) throw new Error(`regeneration output already exists: ${versionDirectory}`);
    mkdirSync(versionDirectory, { recursive: true });
    const raw = Buffer.from(references.map((reference) => JSON.stringify(canonicalize(reference))).join("\n") + (references.length ? "\n" : ""), "utf8");
    const compressed = gzipSync(raw, { level: 9 });
    writeFileSync(path.join(versionDirectory, "regenerated-references-000.jsonl.gz"), compressed);
    writeFileSync(path.join(versionDirectory, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, kind: "action-compilation-fullcatalog-regeneration", sourceDirectory: args.source, sourceRecords: sources.length, acceptedReferences: references.length, providerRequests: sources.length, sourceHash: contentHash(sources), regeneratedAt: new Date().toISOString(), shard: { file: "regenerated-references-000.jsonl.gz", sha256: contentHash(compressed.toString("base64")), records: references.length, compressedBytes: compressed.byteLength } }, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ output: versionDirectory, sourceRecords: sources.length, providerRequests: sources.length, acceptedReferences: references.length }, null, 2)}\n`); return 0;
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
