// CLI entry point for script validation.
// Usage: tsx scripts/validate-script.ts <script-dir> [more dirs...]
// Exits 0 when all scripts validate, 1 when any script has issues or args are invalid.
import { validateScriptDir, type ValidationIssue } from "../src/script/validate";

function printIssue(scriptDir: string, issue: ValidationIssue): void {
  const loc = issue.line !== undefined ? `:${issue.line}` : "";
  console.error(`  ✗ ${scriptDir}/${issue.file}${loc} [${issue.path}] ${issue.message}`);
}

function main(): void {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("usage: npm run script:validate -- <script-dir> [more dirs...]");
    console.error("  or:  npx tsx scripts/validate-script.ts scripts/emberfall");
    process.exit(1);
  }

  let allOk = true;
  for (const dir of dirs) {
    console.log(`Validating script: ${dir}`);
    const result = validateScriptDir(dir);
    if (result.ok) {
      console.log(`  ✓ ${result.scriptId}: valid (${dir})`);
    } else {
      allOk = false;
      console.error(`  ✗ ${result.scriptId}: ${result.issues.length} issue(s)`);
      for (const issue of result.issues) printIssue(dir, issue);
    }
  }

  if (!allOk) {
    console.error("\nValidation failed.");
    process.exit(1);
  }
  console.log("\nAll scripts valid.");
  process.exit(0);
}

main();
