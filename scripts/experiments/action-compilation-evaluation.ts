import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RuntimeEvent } from "../../src/engine/runtime/observability";
import { LocalDatabase } from "../../src/server/local-database";

interface Arguments {
  database: string;
  executionId: string;
  output?: string;
  verify?: string;
}

interface SerializedContextEvent extends RuntimeEvent {
  payload: {
    context: Record<string, unknown> & {
      repair?: { issues?: readonly { reason?: unknown }[] } | null;
      state?: { slots?: readonly unknown[] };
    };
  };
}

function argumentsFor(argv: readonly string[]): Arguments {
  let database: string | undefined;
  let executionId: string | undefined;
  let output: string | undefined;
  let verify: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
    if (name === "--database") database = path.resolve(value);
    else if (name === "--execution") executionId = value;
    else if (name === "--output") output = path.resolve(value);
    else if (name === "--verify") verify = path.resolve(value);
    else throw new Error(`unknown argument: ${name}`);
    index += 1;
  }
  if (!database || !executionId) {
    throw new Error("usage: --database <sqlite> --execution <id> [--output <json>] [--verify <json>]");
  }
  return { database, executionId, output, verify };
}

function serializedContextEvents(events: readonly RuntimeEvent[]): SerializedContextEvent[] {
  return events.filter((event): event is SerializedContextEvent =>
    event.event === "model.context.serialized" &&
    event.correlation?.modelRole === "action-compilation" &&
    !!event.payload && typeof event.payload === "object" &&
    "context" in event.payload,
  );
}

function numberMeasurement(event: RuntimeEvent | undefined, name: string): number | null {
  const value = event?.measurements?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumKnown(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function roundedRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function repairIssueCategory(reason: unknown): string {
  const text = typeof reason === "string" ? reason : "";
  if (text.includes("reference.unknown_handle")) return "unknown_handle";
  if (text.includes("cannot be used as")) return "illegal_reference_use";
  if (text.includes("rate temporal profile")) return "temporal_evidence";
  if (text.includes('"code"') || text.includes("expected")) return "schema";
  return "other";
}

function sortedCounts(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function buildReport(database: LocalDatabase, executionId: string) {
  const execution = database.execution(executionId);
  if (!execution) throw new Error(`execution not found: ${executionId}`);
  const events = database.executionEvents(executionId);
  const contexts = serializedContextEvents(events);
  if (contexts.length === 0) throw new Error(`execution has no Action Compilation contexts: ${executionId}`);
  const contextByInvocation = new Map(contexts.map((event) => [event.correlation!.modelInvocationId!, event]));
  const outputEvents = events.filter((event) =>
    event.correlation?.modelRole === "action-compilation" &&
    (event.event === "model.structured_output.parsed" || event.event === "model.structured_output.rejected"),
  );
  const requests = outputEvents.map((event) => {
    const contextEvent = contextByInvocation.get(event.correlation?.modelInvocationId ?? "");
    if (!contextEvent) throw new Error(`Action Compilation output has no serialized context: ${event.sequence}`);
    return {
      repair: contextEvent.payload.context.repair != null,
      contextBytes: numberMeasurement(contextEvent, "contextUtf8Bytes"),
      inputTokens: numberMeasurement(event, "inputTokens"),
      cacheReadTokens: numberMeasurement(event, "cacheReadTokens"),
      outputTokens: numberMeasurement(event, "outputTokens"),
      rejected: event.event === "model.structured_output.rejected",
    };
  });
  const initialRequests = requests.filter((request) => !request.repair);
  const repairRequests = requests.filter((request) => request.repair);
  const semanticRejections = events.filter((event) =>
    event.event === "model.semantic.rejected" && event.correlation?.modelRole === "action-compilation",
  );
  const projectionEvents = events.filter((event) =>
    event.event === "algorithm.eager_reference.action_compilation_context_projected",
  );
  const issueReasons = contexts.flatMap((event) =>
    event.payload.context.repair?.issues?.map((issue) => issue.reason) ?? [],
  );
  const representative = contexts.find((event) =>
    event.payload.context.repair == null && event.payload.context.state?.slots?.length === 5,
  );
  if (!representative) throw new Error("execution has no initial five-slot Action Compilation context");
  const representativeContext = representative.payload.context;
  const sectionBytes = Object.fromEntries(Object.entries(representativeContext)
    .map(([name, value]) => [name, jsonBytes(value)]));
  const state = representativeContext.state as Record<string, unknown>;
  const stateSectionBytes = Object.fromEntries(Object.entries(state)
    .map(([name, value]) => [name, jsonBytes(value)]));
  const initialInputTokens = sumKnown(initialRequests.map((request) => request.inputTokens));
  const repairInputTokens = sumKnown(repairRequests.map((request) => request.inputTokens));
  const totalInputTokens = initialInputTokens + repairInputTokens;
  const initialContextBytes = sumKnown(initialRequests.map((request) => request.contextBytes));
  const repairContextBytes = sumKnown(repairRequests.map((request) => request.contextBytes));

  return {
    schemaVersion: 1,
    source: {
      executionId: execution.id,
      instanceId: execution.instanceId ?? null,
      status: execution.status,
      codeRevision: execution.codeRevision,
      codeDirty: execution.codeDirty,
      worldHash: execution.worldHash,
      algorithm: execution.manifest.kind === "algorithm"
        ? { id: execution.manifest.id, version: execution.manifest.version, hash: execution.manifest.hash }
        : { kind: execution.manifest.kind },
      traceHash: execution.traceHash ?? null,
    },
    workload: {
      initialLogicalBatches: initialRequests.length,
      physicalRequests: requests.length,
      repairOrSplitRequests: repairRequests.length,
      distinctSubjects: new Set(contexts.map((event) => event.correlation?.modelSubject)).size,
      parsedResponses: requests.filter((request) => !request.rejected).length,
      structuredOutputRejections: requests.filter((request) => request.rejected).length,
      semanticRejections: semanticRejections.length,
      semanticValidationIssues: sumKnown(semanticRejections.map((event) => event.counts?.validationIssues ?? null)),
    },
    tokens: {
      responsesWithKnownUsage: requests.filter((request) => request.inputTokens !== null).length,
      responsesWithUnknownUsage: requests.filter((request) => request.inputTokens === null).length,
      totalInput: totalInputTokens,
      initialInput: initialInputTokens,
      repairInput: repairInputTokens,
      cacheRead: sumKnown(requests.map((request) => request.cacheReadTokens)),
      output: sumKnown(requests.map((request) => request.outputTokens)),
      repairToInitialRatio: roundedRatio(repairInputTokens, initialInputTokens),
      totalToInitialRatio: roundedRatio(totalInputTokens, initialInputTokens),
    },
    bytes: {
      totalContext: initialContextBytes + repairContextBytes,
      initialContext: initialContextBytes,
      repairContext: repairContextBytes,
      repairToInitialRatio: roundedRatio(repairContextBytes, initialContextBytes),
      representativeInitialFiveSlot: {
        sequence: representative.sequence,
        context: numberMeasurement(representative, "contextUtf8Bytes"),
        ledgerArtifactRaw: numberMeasurement(representative, "ledgerArtifactRawBytes"),
        sections: sectionBytes,
        stateSections: stateSectionBytes,
      },
    },
    repairIssues: {
      total: issueReasons.length,
      categories: sortedCounts(issueReasons.map(repairIssueCategory)),
    },
    ...(projectionEvents.length > 0 ? {
      projectionTelemetry: {
        events: projectionEvents.length,
        variants: sortedCounts(projectionEvents.map((event) => String(event.attributes?.projection))),
        candidateHandles: sumKnown(projectionEvents.map((event) => event.counts?.candidateHandles ?? null)),
        serializedCandidates: sumKnown(projectionEvents.map((event) => event.counts?.serializedCandidates ?? null)),
        detailedCandidates: sumKnown(projectionEvents.map((event) => event.counts?.detailedCandidates ?? null)),
        repairIssues: sumKnown(projectionEvents.map((event) => event.counts?.repairIssues ?? null)),
      },
    } : {}),
  };
}

const args = argumentsFor(process.argv.slice(2));
const database = new LocalDatabase(args.database);
try {
  const report = buildReport(database, args.executionId);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.verify) {
    const expected = `${JSON.stringify(JSON.parse(readFileSync(args.verify, "utf8")), null, 2)}\n`;
    if (output !== expected) throw new Error(`report differs from baseline: ${args.verify}`);
  }
  if (args.output) {
    mkdirSync(path.dirname(args.output), { recursive: true });
    writeFileSync(args.output, output);
  } else {
    process.stdout.write(output);
  }
} finally {
  database.close();
}
