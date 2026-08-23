import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export function fixtureArchive(): Buffer {
  const root = path.resolve("test/fixtures/open-world-script");
  const zip = new AdmZip();
  const visit = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const next = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(absolute, next);
      else zip.addFile(path.posix.join("world", next), readFileSync(absolute));
    }
  };
  visit(root, "");
  return zip.toBuffer();
}
