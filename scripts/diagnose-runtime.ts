import {
  parseDiagnosticMatrix,
  runDeterministicRuntimeDiagnostic,
} from "./runtime-diagnostic-core";

async function main(): Promise<void> {
  const matrix = parseDiagnosticMatrix(process.argv.slice(2));
  const result = await runDeterministicRuntimeDiagnostic({
    ...matrix,
    write: (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
  });
  process.stderr.write("agents steps invocations input-bytes archive-bytes\n");
  for (const scenario of result.scenarios) {
    process.stderr.write([
      String(scenario.agents).padStart(6),
      String(scenario.steps).padStart(5),
      String(scenario.modelInvocations).padStart(11),
      String(scenario.cumulativeInputBytes).padStart(11),
      String(scenario.archiveBytes).padStart(13),
    ].join(" ") + "\n");
  }
}

void main().catch((error) => {
  process.stderr.write(`runtime diagnostic failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
