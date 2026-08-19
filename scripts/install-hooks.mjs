#!/usr/bin/env node
// install-hooks.mjs — install the repo-seed pre-commit hook into a target
// repository's .git/hooks. Zero dependencies; Node >= 18.
// Usage: install-hooks.mjs <target-dir>
// The hook runs the four verifiers (whitespace is built into the hook script
// via `git diff --cached --check`). Never touches global git config.
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const HOOK_NAME = 'pre-commit';

export function hookScript(repoRoot) {
  // repoRoot is the absolute target directory; the hook resolves scripts relative to it.
  return `#!/bin/sh
# repo-seed pre-commit hook (installed by scripts/install-hooks.mjs)
# Runs the governance gates on every commit. Zero dependencies.
set -e
cd "${repoRoot}" || exit 1

node scripts/verify-decisions.mjs
node scripts/verify-doc-links.mjs
node scripts/verify-placeholders.mjs
node scripts/verify-manifest.mjs
git diff --cached --check
`;
}

export async function installHook(targetDir) {
  // Resolve the hooks directory the way git actually resolves it, so the
  // hook lands where git executes hooks. This is the common hooks dir for
  // both regular repositories and linked worktrees (git has no per-worktree
  // hook mechanism; .git/worktrees/<name>/hooks is never consulted).
  let hooksDir;
  try {
    hooksDir = execSync('git rev-parse --git-path hooks', { cwd: targetDir })
      .toString()
      .trim();
  } catch {
    throw new Error(`not a git repository: ${targetDir} (git rev-parse --git-path hooks failed)`);
  }
  if (!hooksDir) throw new Error(`cannot resolve hooks dir for ${targetDir}`);
  await writeHook(hooksDir, targetDir);
  return hooksDir;
}

async function writeHook(hooksDir, targetDir) {
  await mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, HOOK_NAME);
  await writeFile(hookPath, hookScript(targetDir), { mode: 0o755 });
  // Ensure executable bit on platforms that need it
  await chmod(hookPath, 0o755);
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: install-hooks.mjs <target-dir>');
    process.exit(2);
  }
  const abs = path.resolve(target);
  try {
    const hooksDir = await installHook(abs);
    console.log(`install-hooks: installed ${HOOK_NAME} in ${hooksDir}/`);
  } catch (e) {
    console.error(`install-hooks: ${e.message}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((e) => {
    console.error('install-hooks: fatal', e);
    process.exit(2);
  });
}
