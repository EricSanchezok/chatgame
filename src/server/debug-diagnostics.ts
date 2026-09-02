import type { DebugDiagnostic } from "../shared/debug-api";
import type { RuntimeError, RuntimeEvent } from "../engine/runtime/observability";

export interface DiagnosticDefinition {
  code: string;
  domain: string;
  owner: string;
  severity: DebugDiagnostic["severity"];
  retryability: DebugDiagnostic["retryability"];
  description: string;
  sourcePaths: readonly string[];
  testPaths: readonly string[];
}

const definitions: readonly DiagnosticDefinition[] = [
  {
    code: "runtime.model.transport",
    domain: "transport",
    owner: "src/engine/models",
    severity: "error",
    retryability: "retryable",
    description: "A model transport request failed or was retried.",
    sourcePaths: ["src/engine/models/model-gateway.ts", "src/engine/models/model-network.ts"],
    testPaths: ["src/engine/models/__tests__/model-provider.test.ts", "src/engine/models/__tests__/model-network.test.ts"],
  },
  {
    code: "runtime.model.output",
    domain: "model",
    owner: "src/engine/models",
    severity: "warn",
    retryability: "not_retryable",
    description: "A model response could not be accepted as the requested structured output.",
    sourcePaths: ["src/engine/models/model-provider.ts", "src/engine/models/semantic-repair.ts"],
    testPaths: ["src/engine/models/__tests__/semantic-repair.test.ts", "src/engine/models/__tests__/model-provider.test.ts"],
  },
  {
    code: "runtime.semantic.validation",
    domain: "semantic",
    owner: "src/engine/contracts",
    severity: "warn",
    retryability: "not_retryable",
    description: "A model candidate failed a semantic or structural validation boundary.",
    sourcePaths: ["src/engine/contracts/prompts.ts", "src/engine/algorithms/eager-reference"],
    testPaths: ["src/engine/algorithms/eager-reference/__tests__/action-compilation-validation.test.ts"],
  },
  {
    code: "runtime.execution.rollback",
    domain: "execution",
    owner: "src/engine/runtime",
    severity: "error",
    retryability: "unknown",
    description: "Candidate generation or commit failed and the execution rolled back.",
    sourcePaths: ["src/engine/runtime/simulation.ts", "src/server/world-host.ts"],
    testPaths: ["src/engine/runtime/__tests__/observability.test.ts", "src/server/__tests__/run-failure.test.ts"],
  },
  {
    code: "runtime.persistence",
    domain: "persistence",
    owner: "src/server/local-database.ts",
    severity: "error",
    retryability: "unknown",
    description: "SQLite, lease, CAS, artifact, or Ledger persistence failed.",
    sourcePaths: ["src/server/local-database.ts", "src/server/execution-ledger.ts"],
    testPaths: ["src/server/__tests__/execution-ledger.test.ts", "src/server/__tests__/world-instance-host.test.ts"],
  },
  {
    code: "runtime.inspector.lookup",
    domain: "inspector",
    owner: "src/server/world-inspector.ts",
    severity: "error",
    retryability: "not_retryable",
    description: "An Inspector identity, event, artifact, or projection lookup failed.",
    sourcePaths: ["src/server/world-inspector.ts", "src/app/api/instances"],
    testPaths: ["src/server/__tests__/world-inspector-model-invocations.test.ts"],
  },
  {
    code: "runtime.unknown",
    domain: "runtime",
    owner: "src/engine/runtime",
    severity: "error",
    retryability: "unknown",
    description: "An unclassified runtime failure; inspect the attached error and event chain.",
    sourcePaths: ["src/engine/runtime", "src/server"],
    testPaths: ["src/engine/runtime/__tests__/observability.test.ts"],
  },
];

const byCode = new Map(definitions.map((definition) => [definition.code, definition]));

function normalizeName(value: string): string {
  return value
    .replace(/Error$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1.$2")
    .replace(/[^a-zA-Z0-9.]+/gu, ".")
    .toLowerCase();
}

export function diagnosticDefinitions(): readonly DiagnosticDefinition[] {
  return definitions;
}

export function diagnosticDefinition(code: string): DiagnosticDefinition {
  return byCode.get(code) ?? byCode.get("runtime.unknown")!;
}

export function diagnosticCodeFor(errorName?: string, eventName?: string): string {
  const normalized = normalizeName(errorName ?? "");
  if (normalized.includes("transport") || normalized.includes("gateway") || normalized.includes("network")) {
    return "runtime.model.transport";
  }
  if (normalized.includes("output") || normalized.includes("schema") || normalized.includes("structured")) {
    return "runtime.model.output";
  }
  if (normalized.includes("validation") || normalized.includes("reference") || normalized.includes("semantic")) {
    return "runtime.semantic.validation";
  }
  if (normalized.includes("rollback") || normalized.includes("execution") || normalized.includes("candidate")) {
    return "runtime.execution.rollback";
  }
  if (normalized.includes("database") || normalized.includes("sqlite") || normalized.includes("lease") || normalized.includes("cas")) {
    return "runtime.persistence";
  }
  if (eventName?.startsWith("model.transport.")) return "runtime.model.transport";
  if (eventName?.includes("structured_output")) return "runtime.model.output";
  if (eventName?.includes("semantic.")) return "runtime.semantic.validation";
  if (eventName?.startsWith("execution.") || eventName?.startsWith("step.rollback")) return "runtime.execution.rollback";
  if (eventName?.startsWith("persistence.")) return "runtime.persistence";
  if (eventName?.startsWith("inspector.")) return "runtime.inspector.lookup";
  return "runtime.unknown";
}

export function diagnosticForEvent(event: RuntimeEvent): DiagnosticDefinition | undefined {
  if (!event.error && event.level !== "error" && !event.event.includes("rejected") && !event.event.includes("failed")) {
    return undefined;
  }
  return diagnosticDefinition(event.error?.code ?? diagnosticCodeFor(event.error?.name, event.event));
}

export function diagnosticForError(error: RuntimeError, eventName?: string): DiagnosticDefinition {
  return diagnosticDefinition(error.code ?? diagnosticCodeFor(error.name, eventName));
}

export function publicDiagnostic(
  definition: DiagnosticDefinition,
  input: { message?: string; eventSequence?: number; artifactHash?: string } = {},
): DebugDiagnostic {
  return {
    code: definition.code,
    domain: definition.domain,
    owner: definition.owner,
    severity: definition.severity,
    retryability: definition.retryability,
    ...(input.message ? { message: input.message } : {}),
    ...(input.eventSequence !== undefined ? { eventSequence: input.eventSequence } : {}),
    ...(input.artifactHash ? { artifactHash: input.artifactHash } : {}),
    suggestedCommands: [
      `npm run debug -- explain ${definition.code}`,
      definition.testPaths[0] ? `npm test -- ${definition.testPaths[0]}` : "npm run check:fast",
    ],
  };
}
