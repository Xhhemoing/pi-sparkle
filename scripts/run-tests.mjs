import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

// Preserve separate option values while identifying whether the caller chose
// test files. Equals-form flags pass through unchanged as well.
const optionsWithValues = new Set([
  "--test-concurrency", "--test-name-pattern", "--test-skip-pattern",
  "--test-reporter", "--test-reporter-destination", "--test-shard", "--test-timeout",
  "--test-isolation", "--experimental-test-isolation", "--test-global-setup",
  "--test-coverage-include", "--test-coverage-exclude", "--test-coverage-lines",
  "--test-coverage-functions", "--test-coverage-branches",
  "--import", "--require", "-r", "--loader", "--experimental-loader",
  "--conditions", "-C", "--env-file", "--env-file-if-exists"
]);

async function discoverTests(directory) {
  const tests = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      tests.push(...(await discoverTests(path)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(path);
    }
  }
  return tests;
}

async function expandArgument(argument) {
  if (argument.startsWith("-")) return [argument];

  let details;
  try {
    details = await stat(argument);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [argument];
    throw error;
  }
  if (!details.isDirectory()) return [argument];

  const tests = await discoverTests(argument);
  if (tests.length === 0) {
    throw new Error(`No *.test.ts files found under ${argument}`);
  }
  return tests;
}

async function main() {
  const input = process.argv.slice(2);
  if (input[0] === "--") input.shift();

  const argumentsToNode = [];
  let hasSelection = false;
  for (let index = 0; index < input.length; index += 1) {
    const argument = input[index];
    if (argument.startsWith("-")) {
      argumentsToNode.push(argument);
      if (optionsWithValues.has(argument) && input[index + 1] !== undefined) {
        argumentsToNode.push(input[index + 1]);
        index += 1;
      }
    } else {
      hasSelection = true;
      argumentsToNode.push(...(await expandArgument(argument)));
    }
  }
  if (!hasSelection) argumentsToNode.push(...(await expandArgument("test")));

  // The supported registration hook needs no CLI IPC server. Enumerating
  // defaults also keeps TypeScript test discovery consistent on Node 22.
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--test", ...argumentsToNode], {
    stdio: "inherit"
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
