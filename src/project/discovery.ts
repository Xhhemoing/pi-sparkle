import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { createProjectId, type IdGenerator } from "../domain/ids.js";
import {
  validateProjectSnapshot,
  type DetectedCommand,
  type ProjectSnapshot
} from "../domain/project.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";

const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"];

const MANIFEST_FILE_NAMES = [
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "requirements.txt",
  "tsconfig.json"
];

const SCRIPTS_OF_INTEREST = ["test", "lint", "typecheck", "build", "dev"];

const LOCKFILE_PACKAGE_MANAGERS: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"]
];

const GIT_WALK_LIMIT = 20;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findGitRoot(start: string): Promise<string | undefined> {
  let current = start;
  for (let depth = 0; depth < GIT_WALK_LIMIT; depth++) {
    try {
      const gitStats = await lstat(join(current, ".git"));
      if (gitStats.isDirectory() || gitStats.isFile()) return current;
    } catch {
      // no .git here; keep walking up
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

export async function discoverProject(
  rootPath: string,
  options: { now?: () => IsoTimestamp; generateId?: IdGenerator } = {}
): Promise<ProjectSnapshot> {
  const now = options.now ?? nowIso;
  let canonical: string;
  try {
    canonical = await realpath(rootPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    throw new DomainValidationError(`Invalid project root: ${rootPath} (${code})`);
  }
  const rootStats = await stat(canonical);
  if (!rootStats.isDirectory()) {
    throw new DomainValidationError(`Invalid project root: ${canonical} is not a directory`);
  }

  const instructionFiles: Array<{ path: string }> = [];
  for (const name of INSTRUCTION_FILE_NAMES) {
    const path = join(canonical, name);
    if (await exists(path)) instructionFiles.push({ path });
  }

  const manifests: Array<{ path: string }> = [];
  for (const name of MANIFEST_FILE_NAMES) {
    const path = join(canonical, name);
    if (await exists(path)) manifests.push({ path });
  }

  const commands: DetectedCommand[] = [];
  const packageJsonPath = join(canonical, "package.json");
  if (await exists(packageJsonPath)) {
    try {
      const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      for (const name of SCRIPTS_OF_INTEREST) {
        const command = parsed.scripts?.[name];
        if (typeof command === "string" && command.trim() !== "") {
          commands.push({ name, command });
        }
      }
    } catch {
      // unparsable package.json: record no commands
    }
  }

  const facts: Array<{ key: string; value: string; confidence: "HIGH" }> = [];
  for (const [lockfile, manager] of LOCKFILE_PACKAGE_MANAGERS) {
    if (await exists(join(canonical, lockfile))) {
      facts.push({ key: "package_manager", value: manager, confidence: "HIGH" });
      break;
    }
  }
  const gitRoot = await findGitRoot(canonical);
  if (gitRoot !== undefined) {
    facts.push({ key: "git_root", value: gitRoot, confidence: "HIGH" });
  }

  return validateProjectSnapshot({
    id: createProjectId(options.generateId),
    rootPath: canonical,
    ...(gitRoot !== undefined ? { gitRootPath: gitRoot } : {}),
    discoveredAt: now(),
    instructionFiles,
    manifests,
    commands,
    facts
  });
}
