import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { USAGE } from "../../../src/cli/main.js";

/**
 * Docs-vs-dispatcher parity, in the one direction that can rot silently.
 *
 * `unblock` shipped as the only exit from a BLOCKED run and never got a README
 * row, so the single most important recovery verb is invisible to anyone
 * reading the docs. Nothing failed when that happened, which is why this file
 * exists: the dispatch switch is the source of truth for what the CLI answers
 * to, and every verb in it should have a README command-table row and a line
 * in the usage block.
 *
 * Frozen additive: adding a verb is fine, adding one without documenting it in
 * both places is not.
 */

const REPO_ROOT = process.cwd();

/**
 * Aliases of a documented verb rather than verbs of their own: `version` and
 * `help` carry the rows, and `--version` / `-h` are the flag spellings of the
 * same two cases.
 */
const FLAG_ALIASES = new Set(["--version", "-V", "--help", "-h"]);

/**
 * Verbs the dispatcher answers to that the README command table does not list
 * yet. Both are documented in USAGE, so the CLI itself still describes them.
 *
 * Self-cleaning: the last assertion below fails once a listed verb gains its
 * row, so the row and the removal of the entry land together and the list
 * cannot quietly outlive the gap it records.
 */
const KNOWN_UNDOCUMENTED_VERBS = ["unblock", "help"];

/**
 * The dispatch switch, read from source rather than from an exported list, so
 * the test cannot be satisfied by updating a list nobody dispatches on.
 */
async function dispatchedCommands(): Promise<string[]> {
  const source = await readFile(join(REPO_ROOT, "src", "cli", "main.ts"), "utf8");
  const start = source.indexOf("export async function main(");
  assert.ok(start >= 0, "main() must be findable in src/cli/main.ts");
  const switchStart = source.indexOf("switch (command) {", start);
  assert.ok(switchStart >= 0, "main() must dispatch on a switch over the command");
  const switchEnd = source.indexOf("default:", switchStart);
  assert.ok(switchEnd > switchStart, "the dispatch switch must have a default branch");
  const block = source.slice(switchStart, switchEnd);
  const commands = Array.from(block.matchAll(/case "([^"]+)":/g), (match) => match[1]!);
  assert.ok(commands.length > 10, `expected the full dispatch switch, found ${commands.length} cases`);
  return commands.filter((command) => !FLAG_ALIASES.has(command));
}

/** The first word of every `pnpm cli <verb>` row in the README command table. */
async function readmeCommandTableVerbs(): Promise<Set<string>> {
  const readme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
  const heading = readme.indexOf("\n## Commands\n");
  assert.ok(heading >= 0, "README must have a '## Commands' section");
  const next = readme.indexOf("\n## ", heading + 1);
  const section = readme.slice(heading, next < 0 ? undefined : next);
  const rows = Array.from(section.matchAll(/^\| `pnpm cli ([a-z-]+)/gm), (match) => match[1]!);
  assert.ok(rows.length > 10, `expected a populated command table, found ${rows.length} rows`);
  return new Set(rows);
}

test("every dispatched CLI command has a README command-table row", async () => {
  const commands = await dispatchedCommands();
  const documented = await readmeCommandTableVerbs();
  const missing = commands.filter(
    (command) => !documented.has(command) && !KNOWN_UNDOCUMENTED_VERBS.includes(command)
  );
  assert.deepEqual(
    missing,
    [],
    `dispatched but absent from the README '## Commands' table: ${missing.join(", ")}`
  );
});

test("every dispatched CLI command appears in the usage block", async () => {
  const commands = await dispatchedCommands();
  const missing = commands.filter((command) => !new RegExp(`\\b${command}\\b`).test(USAGE));
  assert.deepEqual(missing, [], `dispatched but absent from USAGE: ${missing.join(", ")}`);
});

test("the README command table invents no verb the CLI does not dispatch", async () => {
  const commands = new Set(await dispatchedCommands());
  const documented = await readmeCommandTableVerbs();
  const unknown = Array.from(documented).filter((verb) => !commands.has(verb));
  assert.deepEqual(unknown, [], `documented but not dispatched: ${unknown.join(", ")}`);
});

test("unblock and its --discard-executed authorization are documented in the usage block", async () => {
  // BLOCKED runs have exactly one exit, and the CLI's own help must name it
  // and the stronger authorization even while the README row is still missing.
  assert.match(USAGE, /^ {2}pi-sparkle unblock --run <runId> --reason <text>/m);
  assert.match(USAGE, /--discard-executed/);
});

test("inspect --follow is documented in the usage block", async () => {
  assert.match(USAGE, /^ {2}pi-sparkle inspect --run <runId> --follow/m);
  assert.match(USAGE, /--idle-timeout-ms/);
});

test("the usage block carries no duplicated --track sentence fragment", async () => {
  // A paste left "predecessor artifacts, assigns other catalog models..." as an
  // orphan sentence after the one it was pasted from; the phrase now occurs
  // exactly once, inside its own sentence.
  const occurrences = USAGE.match(/predecessor artifacts/g) ?? [];
  assert.equal(occurrences.length, 1, "USAGE repeats the --track grounding clause");
  assert.doesNotMatch(USAGE, /\n\s*predecessor artifacts,/);
});

test("the known-undocumented list records only verbs that really lack a README row", async () => {
  const documented = await readmeCommandTableVerbs();
  const stale = KNOWN_UNDOCUMENTED_VERBS.filter((verb) => documented.has(verb));
  assert.deepEqual(
    stale,
    [],
    `these verbs now have README rows; drop them from KNOWN_UNDOCUMENTED_VERBS: ${stale.join(", ")}`
  );
});
