#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const WORKFLOWS_DIR = ".github/workflows";
const NPM_RUN_PATTERN = /\bnpm\s+run\s+([A-Za-z0-9][A-Za-z0-9:._-]*)/g;

export function extractNpmRunScripts(source) {
  return [...source.matchAll(NPM_RUN_PATTERN)].map((match) => match[1]);
}

export async function verifyWorkflowScripts(repoRoot) {
  const packagePath = path.join(repoRoot, "package.json");
  const workflowsPath = path.join(repoRoot, WORKFLOWS_DIR);
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const packageScripts = packageJson.scripts ?? {};
  const entries = await readdir(workflowsPath, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const references = [];
  const errors = [];

  for (const workflowFile of workflowFiles) {
    const source = await readFile(path.join(workflowsPath, workflowFile), "utf8");
    for (const script of extractNpmRunScripts(source)) {
      references.push({ workflowFile, script });
      if (!Object.hasOwn(packageScripts, script)) {
        errors.push(`${workflowFile}: npm script "${script}" is not defined in package.json`);
      }
    }
  }

  return { errors, references, workflowFiles };
}

async function main() {
  const repoRoot = path.resolve(process.argv[2] ?? ".");
  const { errors, references, workflowFiles } = await verifyWorkflowScripts(repoRoot);
  if (errors.length > 0) {
    for (const error of errors) console.error(`verify-workflow-scripts: ${error}`);
    process.exit(1);
  }
  console.log(
    `verify-workflow-scripts: OK (${references.length} references in ${workflowFiles.length} workflows)`,
  );
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error("verify-workflow-scripts: fatal", error);
    process.exit(2);
  });
}
