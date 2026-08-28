import { runCausalActivityBenchmark } from "../../src/engine/benchmarks/causal-activity-benchmark";

function agentMatrix(argv: readonly string[]): number[] | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== "--agents") {
    throw new Error("usage: npm run benchmark:causal -- [--agents 1,10,50,1000]");
  }
  return argv[1].split(",").map(Number);
}

const report = runCausalActivityBenchmark({ agents: agentMatrix(process.argv.slice(2)) });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
