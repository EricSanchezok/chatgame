// CLI entry point for script import.
// Usage:
//   npx tsx scripts/import-script.ts <script-dir> [--replace]
//   npx tsx scripts/import-script.ts <script.zip> [--replace]
// Shares the single import core (src/server/script-import.ts) with the web
// upload path — no dual logic.
import { importScriptFromDir, importScriptFromZip, ScriptImportError } from "../src/server/script-import";
import { readFileSync } from "node:fs";

function main(): void {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const source = args.find((a) => !a.startsWith("--"));
  if (!source) {
    console.error("usage: npx tsx scripts/import-script.ts <script-dir|script.zip> [--replace]");
    process.exit(1);
  }

  try {
    const isZip = source.toLowerCase().endsWith(".zip");
    const result = isZip
      ? importScriptFromZip(readFileSync(source), { replace })
      : importScriptFromDir(source, { replace });
    console.log(`✓ imported "${result.scriptId}"`);
    for (const warning of result.warnings) {
      console.warn(`  ⚠ ${warning}`);
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof ScriptImportError) {
      console.error(`✗ import failed: ${err.message}`);
      for (const issue of err.issues) {
        console.error(`  ✗ ${issue.file} [${issue.path}] ${issue.message}`);
      }
    } else {
      console.error(`✗ import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

main();
