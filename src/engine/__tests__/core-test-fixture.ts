import path from "node:path";
import { loadScript } from "../loader";
import type { WorldDefinition } from "../types";

export const CORE_TEST_SCRIPT_DIR = path.resolve(
  __dirname,
  "../../../test/fixtures/core-test-library/core-test-script",
);

/** Loads the built-in-independent script used by generic engine tests. */
export function loadCoreTestDefinition(): WorldDefinition {
  return loadScript(CORE_TEST_SCRIPT_DIR);
}
