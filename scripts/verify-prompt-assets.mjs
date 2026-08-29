import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const promptRoot = path.join(root, "src", "engine", "prompts");
const sourceRoots = [path.join(root, "src", "engine"), path.join(root, "src", "server")];
const appRoot = path.join(root, "src", "app");
const isPromptAsset = (file) => file.endsWith(".md") && !file.endsWith(`${path.sep}README.md`);
const cjk = /[\u3400-\u9fff]/u;
const inlineModelPrompt = /\b(?:system|userPrompt|prompt)\s*:\s*["'`]/u;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

const failures = [];
for (const file of await walk(promptRoot)) {
  if (!isPromptAsset(file)) continue;
  const content = await readFile(file, "utf8");
  if (!content.replace(/\r\n?/gu, "\n").trim()) failures.push(`${file}: empty prompt asset`);
  if (cjk.test(content)) failures.push(`${file}: prompt asset contains CJK instruction text`);
}

for (const sourceRoot of sourceRoots) {
  for (const file of await walk(sourceRoot)) {
    if (!/\.(?:ts|tsx)$/u.test(file) || /(?:\.test\.|__tests__)/u.test(file)) continue;
    const content = await readFile(file, "utf8");
    if (inlineModelPrompt.test(content)) failures.push(`${file}: inline model-visible prompt text`);
  }
}

for (const file of await walk(appRoot)) {
  if (!/\.(?:ts|tsx)$/u.test(file) || /(?:\.test\.|__tests__)/u.test(file)) continue;
  const content = await readFile(file, "utf8");
  if (content.includes("engine/prompts") || content.includes("../engine/prompts")) {
    failures.push(`${file}: client/app code must not import server prompt resources`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Prompt assets verified (${(await walk(promptRoot)).filter(isPromptAsset).length} files).`);
}
