#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGE_PATH = join(REPO_ROOT, "package.json");
const CLI_PATH = join(REPO_ROOT, "src", "cli", "main.ts");
const OUTCOME_SUPPORTED = "Outcome-supported";
const PI_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai"
];
const TRIPWIRE_NAMES = ["live-isolation", "pi-boundary", "pi-manifest"];

function repoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

async function filesBelow(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function countLiteral(text, literal) {
  if (literal === "") return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(literal, offset)) !== -1) {
    count += 1;
    offset += literal.length;
  }
  return count;
}

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? undefined : match.slice(1).map(Number);
}

function satisfiesSimpleNodeEngine(version, engine) {
  if (typeof engine !== "string") return null;
  const match = /^\s*>=\s*(\d+\.\d+\.\d+)\s*$/.exec(engine);
  const actual = parseVersion(version);
  const required = match === null ? undefined : parseVersion(match[1]);
  if (actual === undefined || required === undefined) return null;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

function extractStatusLines(markdown) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+Status\s*$/i.test(line.trim()));
  if (heading === -1) return [];
  const followingHeading = lines.findIndex(
    (line, index) => index > heading && /^#{1,6}\s+\S/.test(line.trim())
  );
  const end = followingHeading === -1 ? lines.length : followingHeading;
  return lines
    .slice(heading + 1, end)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readAdrs() {
  const decisionFiles = (await filesBelow(join(REPO_ROOT, "docs", "decisions")))
    .filter((path) => path.endsWith(".md"));
  return await Promise.all(
    decisionFiles.map(async (path) => ({
      file: repoPath(path),
      statusLines: extractStatusLines(await readFile(path, "utf8"))
    }))
  );
}

async function extractCliCommands() {
  const failureMode =
    "Best-effort regex reads double-quoted case labels in switch (command) inside exported main(). " +
    "It can miss delegated/generated commands, single-quoted or computed labels, and syntax changes; " +
    "a nested switch inserted before the catch could add false positives.";
  let source;
  try {
    source = await readFile(CLI_PATH, "utf8");
  } catch (error) {
    return {
      source: repoPath(CLI_PATH),
      extracted: false,
      names: [],
      aliases: [],
      error: error instanceof Error ? error.message : String(error),
      failureMode
    };
  }

  const mainStart = source.indexOf("export async function main");
  const switchStart = source.indexOf("switch (command)", mainStart);
  const catchStart = source.indexOf("} catch", switchStart);
  if (mainStart === -1 || switchStart === -1 || catchStart === -1) {
    return {
      source: repoPath(CLI_PATH),
      extracted: false,
      names: [],
      aliases: [],
      error: "Could not delimit main() command switch",
      failureMode
    };
  }

  const labels = Array.from(
    source.slice(switchStart, catchStart).matchAll(/^\s*case\s+"([^"]+)"\s*:/gm),
    (match) => match[1]
  );
  return {
    source: repoPath(CLI_PATH),
    extracted: labels.length > 0,
    names: labels.filter((label) => !label.startsWith("-")),
    aliases: labels.filter((label) => label.startsWith("-")),
    error: labels.length === 0 ? "No double-quoted case labels matched" : null,
    failureMode
  };
}

async function scanOutcomeSupported(docsFiles) {
  const matches = [];
  for (const path of docsFiles) {
    const occurrences = countLiteral(await readFile(path, "utf8"), OUTCOME_SUPPORTED);
    if (occurrences > 0) matches.push({ file: repoPath(path), occurrences });
  }
  return {
    phrase: OUTCOME_SUPPORTED,
    occurrenceCount: matches.reduce((total, match) => total + match.occurrences, 0),
    files: matches,
    method:
      "Case-sensitive literal scan of every regular file under docs/. This lexical signal includes negated, quoted, and policy-example uses."
  };
}

async function buildReport() {
  const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
  const [srcFiles, testFiles, docsFiles, skillFiles, adrs, cli] = await Promise.all([
    filesBelow(join(REPO_ROOT, "src")),
    filesBelow(join(REPO_ROOT, "test")),
    filesBelow(join(REPO_ROOT, "docs")),
    filesBelow(join(REPO_ROOT, ".agents", "skills")),
    readAdrs(),
    extractCliCommands()
  ]);

  const srcTsFiles = srcFiles.filter((path) => path.endsWith(".ts"));
  const testTsFiles = testFiles.filter((path) => path.endsWith(".test.ts"));
  const docsMarkdownFiles = docsFiles.filter((path) => path.endsWith(".md"));
  const skillManifests = skillFiles.filter((path) => basename(path) === "SKILL.md");
  const referenceMarkdown = skillFiles.filter(
    (path) => path.endsWith(".md") && repoPath(path).includes("/references/")
  );
  const skillManifestSizes = await Promise.all(
    skillManifests.map(async (path) => ({ file: repoPath(path), bytes: (await stat(path)).size }))
  );
  const tripwires = Object.fromEntries(
    TRIPWIRE_NAMES.map((name) => {
      const matches = testFiles
        .filter((path) => repoPath(path).toLowerCase().includes(name))
        .map(repoPath);
      return [name, { present: matches.length > 0, matchingTestFiles: matches }];
    })
  );
  const piManifest =
    packageJson.pi !== null && typeof packageJson.pi === "object" ? packageJson.pi : {};
  const dependencies =
    packageJson.dependencies !== null && typeof packageJson.dependencies === "object"
      ? packageJson.dependencies
      : {};
  const declaredNodeEngine =
    packageJson.engines !== null &&
    typeof packageJson.engines === "object" &&
    typeof packageJson.engines.node === "string"
      ? packageJson.engines.node
      : null;

  return {
    schemaVersion: 1,
    package: {
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
      private: packageJson.private ?? null,
      nodeEngine: declaredNodeEngine,
      piPins: Object.fromEntries(
        PI_PACKAGES.map((name) => [
          name,
          typeof dependencies[name] === "string" ? dependencies[name] : null
        ])
      ),
      piManifest: {
        skills: Object.hasOwn(piManifest, "skills"),
        prompts: Object.hasOwn(piManifest, "prompts"),
        extensions: Object.hasOwn(piManifest, "extensions")
      }
    },
    runtime: {
      node: process.version,
      satisfiesDeclaredNodeEngine: satisfiesSimpleNodeEngine(process.version, declaredNodeEngine),
      engineCheck:
        "Boolean only for a simple >=X.Y.Z declaration; null means the probe did not evaluate the range."
    },
    adrs,
    cli,
    counts: {
      "src/**/*.ts": srcTsFiles.length,
      "test/**/*.test.ts": testTsFiles.length,
      "docs/**/*.md": docsMarkdownFiles.length,
      ".agents/skills/**/SKILL.md": skillManifests.length
    },
    isolationTripwires: {
      method: "Case-insensitive substring match against regular-file paths under test/.",
      ...tripwires
    },
    skillOverlay: {
      skillMdBytes: skillManifestSizes.reduce((total, file) => total + file.bytes, 0),
      skillMdFiles: skillManifestSizes,
      referenceMarkdownCount: referenceMarkdown.length,
      referenceMarkdownFiles: referenceMarkdown.map(repoPath)
    },
    forbiddenClaimScan: await scanOutcomeSupported(docsFiles)
  };
}

function printSummary(report) {
  const tripwireCount = TRIPWIRE_NAMES.filter(
    (name) => report.isolationTripwires[name].present
  ).length;
  const engineFit =
    report.runtime.satisfiesDeclaredNodeEngine === null
      ? "not evaluated"
      : String(report.runtime.satisfiesDeclaredNodeEngine);
  console.error(
    [
      "--- market-eval summary ---",
      `${report.package.name}@${report.package.version} (private=${report.package.private})`,
      `Node ${report.runtime.node}; engine ${report.package.nodeEngine}; satisfies=${engineFit}`,
      `Files: src TS=${report.counts["src/**/*.ts"]}, tests=${report.counts["test/**/*.test.ts"]}, docs MD=${report.counts["docs/**/*.md"]}, skills=${report.counts[".agents/skills/**/SKILL.md"]}`,
      `ADRs=${report.adrs.length}; CLI commands=${report.cli.names.length}; isolation tripwires=${tripwireCount}/${TRIPWIRE_NAMES.length}`,
      `${OUTCOME_SUPPORTED} occurrences in docs=${report.forbiddenClaimScan.occurrenceCount}`
    ].join("\n")
  );
}

try {
  const report = await buildReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
} catch (error) {
  console.error(`market-eval probe failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
