import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  allVisibleCandidateRetriever,
  evaluateActionCompilationRecall,
  loadActionCompilationReferenceDataset,
  type CandidateRetriever,
} from "../../src/engine/benchmarks/action-compilation/stabilized-behavior";

interface Arguments {
  dataset: string;
  retriever?: string;
  output?: string;
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseArguments(argv: readonly string[]): Arguments {
  let dataset: string | undefined;
  let retriever: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--dataset") dataset = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--retriever") retriever = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--output") output = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--help") throw new Error("usage: --dataset <directory> [--retriever <module>] [--output <json>]");
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!dataset) throw new Error("usage: --dataset <directory> [--retriever <module>] [--output <json>]");
  return { dataset, retriever, output };
}

async function loadRetriever(file: string | undefined): Promise<{ name: string; retriever: CandidateRetriever }> {
  if (!file) return { name: "all-visible-candidates", retriever: allVisibleCandidateRetriever };
  const loaded = await import(pathToFileURL(file).href);
  const candidate = loaded.default ?? loaded.retriever;
  if (typeof candidate !== "function") throw new Error(`retriever module must export a function: ${file}`);
  return { name: path.basename(file), retriever: candidate as CandidateRetriever };
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Arguments;
  try {
    args = parseArguments(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("usage:")) {
      process.stdout.write(`${message}\n`);
      return 0;
    }
    process.stderr.write(`${message}\n`);
    return 2;
  }
  try {
    const dataset = loadActionCompilationReferenceDataset(args.dataset);
    const loaded = await loadRetriever(args.retriever);
    const report = evaluateActionCompilationRecall(dataset, loaded.retriever, loaded.name);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(path.dirname(args.output), { recursive: true });
      writeFileSync(args.output, serialized, "utf8");
    } else process.stdout.write(serialized);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
