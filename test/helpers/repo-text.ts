import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readRepoText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

export function repoRelative(file: string, repoRoot: string): string {
  return file.slice(repoRoot.length).replaceAll("\\", "/").replace(/^\//, "");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function repoPathFromUrl(url: string): string {
  return fileURLToPath(url);
}
