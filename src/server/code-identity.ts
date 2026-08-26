import { execFileSync } from "node:child_process";

export interface RuntimeCodeIdentity {
  revision: string;
  dirty: boolean;
}

let cached: RuntimeCodeIdentity | undefined;

export function runtimeCodeIdentity(): RuntimeCodeIdentity {
  if (cached) return cached;
  const configuredRevision = process.env.LIVINGWORLD_CODE_REVISION ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (configuredRevision) {
    cached = {
      revision: configuredRevision,
      dirty: process.env.LIVINGWORLD_CODE_DIRTY === "true",
    };
    return cached;
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    cached = { revision, dirty: status.trim().length > 0 };
  } catch {
    cached = { revision: "development", dirty: true };
  }
  return cached;
}
