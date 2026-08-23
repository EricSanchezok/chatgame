import { readFileSync } from "node:fs";
import path from "node:path";
import { loadModelCatalog } from "../src/engine/model-catalog";
import { importWorldArchive } from "../src/server/world-import";

const archive = process.argv[2];
const replace = process.argv.includes("--replace");
if (!archive) {
  process.stderr.write("usage: npm run world:import -- <world.zip> [--replace]\n");
  process.exitCode = 2;
} else {
  try {
    const result = importWorldArchive(
      readFileSync(path.resolve(archive)),
      path.resolve(process.env.CHATGAME_SCRIPTS_ROOT ?? "scripts"),
      loadModelCatalog(path.resolve(process.env.CHATGAME_MODEL_CATALOG_PATH ?? "config/models.yaml")),
      replace,
    );
    process.stdout.write(`${result.id}: ${result.replaced ? "replaced" : "imported"}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
