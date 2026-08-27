import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export default function globalSetup(): void {
  const dataRoot = path.resolve(process.env.LIVINGWORLD_E2E_DATA_ROOT ?? "e2e/artifacts/runtime-data");
  const modelCatalog = path.resolve(
    process.env.LIVINGWORLD_E2E_MODEL_CATALOG_PATH ?? "e2e/artifacts/runtime-models.yaml",
  );
  const modelPort = Number(process.env.LIVINGWORLD_E2E_MODEL_PORT ?? 32128);
  rmSync(dataRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(modelCatalog), { recursive: true });
  const template = readFileSync(path.resolve("e2e/support/models.yaml"), "utf8");
  writeFileSync(modelCatalog, template.replace("http://127.0.0.1:32128", `http://127.0.0.1:${modelPort}`));
}
