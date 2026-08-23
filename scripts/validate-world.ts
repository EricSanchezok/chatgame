import path from "node:path";
import { loadModelCatalog } from "../src/engine/model-catalog";
import { loadWorldScript } from "../src/script/world-loader";

const directory = process.argv[2];
if (!directory) {
  process.stderr.write("usage: npm run world:validate -- <world-directory>\n");
  process.exitCode = 2;
} else {
  try {
    const modelCatalog = loadModelCatalog(path.resolve(
      process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml",
    ));
    const definition = loadWorldScript(path.resolve(directory), { seed: 1, modelCatalog });
    process.stdout.write(`${definition.id}: ${Object.keys(definition.initialState.truth.entities).length} entities, ${Object.keys(definition.initialState.agents).length} agents\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
