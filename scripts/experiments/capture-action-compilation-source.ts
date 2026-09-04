import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDatabase } from "../../src/server/local-database";
import { canonicalize, contentHash } from "../../src/engine/models/model-audit";
import { assertSafeBenchmarkSource, type RawBenchmarkSource } from "../../src/engine/benchmarks/source-capture";
import type { RuntimeEvent } from "../../src/engine/runtime/observability";

interface Args { database: string; executionIds: string[]; output: string; dryRun: boolean; force: boolean; }
function required(argv: readonly string[], index: number, option: string): string { const value = argv[index]; if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`); return value; }
function parse(argv: readonly string[]): Args {
  const result: Args = { database: path.resolve(process.env.LIVINGWORLD_DATA_ROOT ?? ".livingworld-v20", "livingworld.sqlite"), executionIds: [], output: path.resolve(".livingworld-benchmarks/source/action-compilation"), dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--database") result.database = path.resolve(required(argv, ++index, argument));
    else if (argument === "--execution") result.executionIds.push(required(argv, ++index, argument));
    else if (argument === "--output") result.output = path.resolve(required(argv, ++index, argument));
    else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--force") result.force = true;
    else if (argument === "--help") throw new Error("usage: --execution <id> [--execution <id>] [--database <sqlite>] [--output <dir>] [--dry-run] [--force]");
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (result.executionIds.length === 0) throw new Error("provide at least one --execution");
  result.executionIds = [...new Set(result.executionIds)].sort();
  return result;
}
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function payloadContext(event: RuntimeEvent): Record<string, unknown> | undefined {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : undefined;
  const context = payload?.context ?? payload?.fullContext;
  return context && typeof context === "object" && !Array.isArray(context) ? context as Record<string, unknown> : undefined;
}
function sourceFromEvent(executionId: string, event: RuntimeEvent): RawBenchmarkSource | undefined {
  const context = payloadContext(event);
  if (!context || (event.event !== "model.context.serialized" && event.event !== "model.action_compilation.context.captured") || (event.correlation?.modelRole && event.correlation.modelRole !== "action-compilation")) return undefined;
  const captured = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Partial<RawBenchmarkSource> : {};
  const slots = Array.isArray((context.task as { slots?: unknown } | undefined)?.slots) ? (context.task as { slots: unknown[] }).slots : [];
  const slotIndices = slots.map((slot, index) => slot && typeof slot === "object" && !Array.isArray(slot) && typeof (slot as { slot?: unknown }).slot === "number" ? Number((slot as { slot: number }).slot) : index);
  const source: RawBenchmarkSource = {
    sourceExecutionId: executionId,
    sourceInvocationId: captured.sourceInvocationId ?? event.correlation?.modelInvocationId ?? `sequence-${event.sequence}`,
    logicalInvocationId: captured.logicalInvocationId ?? event.correlation?.logicalInvocationId,
    role: "action-compilation",
    slotIndices: Array.isArray(captured.slotIndices) ? captured.slotIndices.filter((slot): slot is number => typeof slot === "number") : slotIndices,
    fullContext: structuredClone(context),
    actionIds: Array.isArray(captured.actionIds) ? captured.actionIds.filter((id): id is string => typeof id === "string") : slots.map((slot, index) => slot && typeof slot === "object" && !Array.isArray(slot) && typeof (slot as { actionId?: unknown }).actionId === "string" ? String((slot as { actionId: string }).actionId) : `slot-${index}`),
    fullContextHash: captured.fullContextHash ?? contentHash(context),
    modelCatalogHash: typeof (context.referenceCatalog as { hash?: unknown } | undefined)?.hash === "string" ? String((context.referenceCatalog as { hash: string }).hash) : undefined,
    repairCount: captured.repairCount ?? event.correlation?.semanticRepairAttempt ?? 0,
    ...(captured.modelContextHash ? { modelContextHash: captured.modelContextHash } : {}),
    ...(captured.shortlistHash ? { shortlistHash: captured.shortlistHash } : {}),
    ...(captured.stateSnapshot !== undefined ? { stateSnapshot: captured.stateSnapshot } : {}),
    ...(captured.stateHash ? { stateHash: captured.stateHash } : {}),
    ...(captured.worldHash ? { worldHash: captured.worldHash } : {}),
    ...(captured.promptVersion ? { promptVersion: captured.promptVersion } : {}),
    ...(captured.profileId ? { profileId: captured.profileId } : {}),
  };
  assertSafeBenchmarkSource(source);
  return source;
}
export function main(argv: readonly string[]): number {
  let args: Args;
  try { args = parse(argv); } catch (error) { const message = error instanceof Error ? error.message : String(error); if (message.startsWith("usage:")) { process.stdout.write(`${message}\n`); return 0; } process.stderr.write(`${message}\n`); return 2; }
  try {
    const database = new LocalDatabase(args.database, { readOnly: true, heartbeat: false });
    const sources: RawBenchmarkSource[] = [];
    for (const executionId of args.executionIds) {
      const events = database.executionEvents(executionId);
      for (const event of events) {
        const source = sourceFromEvent(executionId, event);
        if (source) sources.push(source);
      }
    }
    const unique = [...new Map(sources.map((source) => [`${source.sourceExecutionId}:${source.sourceInvocationId}`, source])).values()]
      .sort((left, right) => left.sourceExecutionId.localeCompare(right.sourceExecutionId) || left.sourceInvocationId.localeCompare(right.sourceInvocationId));
    const summary = { output: args.output, sourceRecords: unique.length, executions: args.executionIds, providerRequestsDuringCapture: 0, networkRequests: 0, worldMutations: 0, dryRun: args.dryRun };
    if (args.dryRun) { process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`); return 0; }
    const manifestFile = path.join(args.output, "manifest.json");
    if (!args.force && existsSync(manifestFile)) throw new Error(`capture output already exists: ${manifestFile} (use --force to replace it)`);
    mkdirSync(args.output, { recursive: true });
    const raw = Buffer.from(unique.map((source) => JSON.stringify(canonicalize(source))).join("\n") + (unique.length ? "\n" : ""), "utf8");
    const compressed = gzipSync(raw, { level: 9 });
    writeFileSync(path.join(args.output, "sources-000.jsonl.gz"), compressed);
    writeFileSync(manifestFile, `${JSON.stringify({ schemaVersion: 1, kind: "action-compilation-source-capture", role: "action-compilation", sourceExecutionIds: args.executionIds, records: unique.length, file: "sources-000.jsonl.gz", rawBytes: raw.byteLength, compressedBytes: compressed.byteLength, sha256: sha256(compressed), capturedAt: new Date().toISOString(), offline: { providerRequests: 0, networkRequests: 0, worldMutations: 0 } }, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`); return 0;
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
