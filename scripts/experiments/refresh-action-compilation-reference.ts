import path from "node:path";
import { fileURLToPath } from "node:url";
import { main as capture } from "./capture-action-compilation-source";
import { main as regenerate } from "./regenerate-action-compilation-reference";

function required(argv: readonly string[], index: number, option: string): string { const value = argv[index]; if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`); return value; }

export async function main(argv: readonly string[]): Promise<number> {
  let database: string | undefined;
  const execution: string[] = [];
  let source: string | undefined;
  let output: string | undefined;
  let providerModule: string | undefined;
  let version = 2;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--database") database = required(argv, ++index, argument);
    else if (argument === "--execution") execution.push(required(argv, ++index, argument));
    else if (argument === "--source") source = required(argv, ++index, argument);
    else if (argument === "--output") output = required(argv, ++index, argument);
    else if (argument === "--provider-module") providerModule = required(argv, ++index, argument);
    else if (argument === "--version") version = Number(required(argv, ++index, argument));
    else if (argument === "--help") { process.stdout.write("usage: --execution <id> --source <capture-dir> --output <dataset-root> --provider-module <module> [--database <sqlite>]\n"); return 0; }
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (execution.length === 0 || !source || !output || !providerModule) throw new Error("usage: --execution <id> --source <capture-dir> --output <dataset-root> --provider-module <module> [--database <sqlite>]");
  const captureArgs = execution.flatMap((id) => ["--execution", id]).concat(["--output", path.resolve(source), ...(database ? ["--database", database] : [])]);
  const captureCode = capture(captureArgs);
  if (captureCode !== 0) return captureCode;
  return regenerate(["--source", path.resolve(source), "--output", path.resolve(output), "--version", String(version), "--provider-module", path.resolve(providerModule)]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
