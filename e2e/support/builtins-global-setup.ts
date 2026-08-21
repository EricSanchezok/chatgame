import { rmSync } from "node:fs";
import path from "node:path";

export default function globalSetup(): void {
  rmSync(path.resolve("e2e/artifacts/builtins-runtime-data"), { recursive: true, force: true });
}
