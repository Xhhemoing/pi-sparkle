import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

  const argumentsToTsx = [];
  for (const argument of input) {
    argumentsToTsx.push(...(await expandArgument(argument)));
  }

  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const child = spawn(process.execPath, [tsxCli, "--test", ...argumentsToTsx], {
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
