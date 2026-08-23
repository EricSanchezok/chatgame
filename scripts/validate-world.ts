import path from "node:path";
import { loadWorldScript } from "../src/script/world-loader";

const directory = process.argv[2];
if (!directory) {
  process.stderr.write("usage: npm run world:validate -- <world-directory>\n");
  process.exitCode = 2;
} else {
  try {
    const definition = loadWorldScript(path.resolve(directory), 1);
    process.stdout.write(`${definition.id}: ${Object.keys(definition.initialState.truth.entities).length} entities, ${Object.keys(definition.initialState.agents).length} agents\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
