import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createEpisodeId, parseEpisodeId } from "../domain/ids.js";
import {
  withExclusiveFileLock,
  type FileLockOptions
} from "../persist/file-lock.js";
import { exportAuthorizedPreferences } from "../preferences/export.js";
import { getMaterializedView } from "../preferences/materialize.js";
import {
  configurePreferencePersistence,
  correctPreference,
  deletePreference,
  inspectPreferences
} from "../preferences/service.js";
import {
  preferenceSnapshotLockPath,
  preferenceSnapshotPath
} from "../preferences/store.js";
import type { PreferenceScope } from "../preferences/types.js";
import { lockWaitOptions } from "./main.js";
import type { CliIo } from "./main.js";

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

const PREFERENCE_SCOPES = ["user", "project", "task-family", "role", "model"] as const;

function isPreferenceScope(value: string): value is PreferenceScope {
  return (PREFERENCE_SCOPES as readonly string[]).includes(value);
}

function parsePreferenceValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(num)) return num;
  return raw;
}

const PREF_USAGE = `pi-sparkle pref — preference inspection and correction

Usage:
  pi-sparkle pref list [--scope user|project|task-family|role|model] [--state-root <dir>]
  pi-sparkle pref correct --scope <scope> --scope-key <key> --key <name> --value <value> [--episode <epId>] [--lock-wait-ms <ms>] [--state-root <dir>]
  pi-sparkle pref export [--scope <scope>] [--state-root <dir>]
  pi-sparkle pref delete --id <preferenceId> [--lock-wait-ms <ms>] [--state-root <dir>]

correct and delete rewrite the whole preference snapshot, so each holds the
cooperative lock adaptation/preferences.json.lock while it reads, changes and
republishes the file. --lock-wait-ms bounds that wait (default 5000); 0 refuses
immediately rather than waiting at all. Either way the mutation fails closed: a
wait that runs out writes nothing. list and export do not take the lock — the
snapshot is published by rename, so a reader sees one whole version or another.
`;

export function bindPreferenceStore(stateRoot: string): void {
  configurePreferencePersistence(preferenceSnapshotPath(stateRoot));
}

/**
 * One preference mutation, serialized against every other process mutating the
 * same snapshot.
 *
 * `bindPreferenceStore` loads the whole snapshot and every mutator persists the
 * whole in-memory state, so the read-modify-write window is the entire command.
 * Two unsynchronized `pref` mutations that overlap in that window are
 * last-writer-wins, and the loser vanishes without an error — including a
 * `pref delete` whose tombstone a concurrent `pref correct` bound a moment
 * earlier would write back out, resurrecting an observation the CLI already
 * reported deleted. The lock therefore has to cover the load as well as the
 * write: binding happens *inside* it, so what gets persisted derives from bytes
 * read while no other writer could be between its own load and its own write.
 *
 * Acquisition is bounded and fails closed. A timeout throws the frozen
 * `LOCK_TIMEOUT` before anything binds or is written, and the CLI's failure
 * surface routes that code to `pi-sparkle doctor --json`, whose `locks[]`
 * inventory names the holder. Locks are never stolen.
 */
async function withPreferenceSnapshotLock<T>(
  stateRoot: string,
  mutate: () => T,
  options: FileLockOptions
): Promise<T> {
  return await withExclusiveFileLock(
    preferenceSnapshotLockPath(stateRoot),
    () => {
      bindPreferenceStore(stateRoot);
      return Promise.resolve(mutate());
    },
    options
  );
}

async function prefList(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { scope: { type: "string" }, "state-root": { type: "string" } }
  });
  bindPreferenceStore(values["state-root"] ?? defaultStateRoot());
  let scope: PreferenceScope | undefined;
  if (values.scope !== undefined) {
    if (!isPreferenceScope(values.scope)) {
      io.stderr(`Invalid preference scope: ${values.scope}\n`);
      return 1;
    }
    scope = values.scope;
  }
  const result = inspectPreferences(scope);
  io.stdout(`preferences: ${result.count} observation(s)\n`);
  for (const obs of result.observations) {
    io.stdout(
      `  ${obs.id} [${obs.scope}:${obs.scopeKey}] ${obs.key}=${String(obs.value)} explicit=${obs.explicit} recurrence=${obs.recurrenceCount} episode=${obs.evidenceEpisodeId}\n`
    );
  }
  const pairs = new Map<string, { scope: PreferenceScope; scopeKey: string }>();
  for (const obs of result.observations) {
    pairs.set(`${obs.scope}:${obs.scopeKey}`, { scope: obs.scope, scopeKey: obs.scopeKey });
  }
  for (const pair of Array.from(pairs.values())) {
    const materialized = getMaterializedView(pair.scope, pair.scopeKey);
    if (materialized === undefined) continue;
    io.stdout(
      `  effective [${pair.scope}:${pair.scopeKey}] confidence=${materialized.view.confidence} sources=${materialized.view.sourceCount}\n`
    );
    for (const [key, value] of Object.entries(materialized.effectiveKeys)) {
      io.stdout(`    ${key}=${String(value)}\n`);
    }
  }
  return 0;
}

async function prefCorrect(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      scope: { type: "string" },
      "scope-key": { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      episode: { type: "string" },
      "lock-wait-ms": { type: "string" },
      "state-root": { type: "string" }
    }
  });
  const scope = values.scope;
  const scopeKey = values["scope-key"];
  const key = values.key;
  const value = values.value;
  if (scope === undefined || !isPreferenceScope(scope)) {
    io.stderr(`pref correct requires --scope to be one of ${PREFERENCE_SCOPES.join("|")}\n`);
    return 1;
  }
  if (!scopeKey || !key || value === undefined) {
    io.stderr("pref correct requires --scope-key, --key and --value\n");
    return 1;
  }
  const episodeId = values.episode !== undefined ? parseEpisodeId(values.episode) : createEpisodeId();
  // Arguments are checked first, so the lock is only ever asked for by an
  // invocation that is going to write: a misspelled scope has no business
  // making a concurrent mutator wait behind it.
  const obs = await withPreferenceSnapshotLock(
    values["state-root"] ?? defaultStateRoot(),
    () => correctPreference(scope, scopeKey, key, parsePreferenceValue(value), episodeId),
    lockWaitOptions(values["lock-wait-ms"])
  );
  io.stdout(`recorded explicit preference ${obs.id}\n`);
  return 0;
}

async function prefExport(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { scope: { type: "string" }, "state-root": { type: "string" } }
  });
  bindPreferenceStore(values["state-root"] ?? defaultStateRoot());
  let scopes: PreferenceScope[] | undefined;
  if (values.scope !== undefined) {
    if (!isPreferenceScope(values.scope)) {
      io.stderr(`Invalid preference scope: ${values.scope}\n`);
      return 1;
    }
    scopes = [values.scope];
  }
  const result = exportAuthorizedPreferences(scopes !== undefined ? { scopes } : {});
  io.stdout(`${result.data}\n`);
  return 0;
}

async function prefDelete(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      id: { type: "string" },
      "lock-wait-ms": { type: "string" },
      "state-root": { type: "string" }
    }
  });
  const id = values.id;
  if (id === undefined) {
    io.stderr("pref delete requires --id <preferenceId>\n");
    return 1;
  }
  const deleted = await withPreferenceSnapshotLock(
    values["state-root"] ?? defaultStateRoot(),
    () => deletePreference(id),
    lockWaitOptions(values["lock-wait-ms"])
  );
  io.stdout(deleted ? `tombstoned preference ${id}\n` : `preference not found: ${id}\n`);
  return deleted ? 0 : 1;
}

export async function prefCommand(args: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return await prefList(rest, io);
    case "correct":
      return await prefCorrect(rest, io);
    case "export":
      return await prefExport(rest, io);
    case "delete":
      return await prefDelete(rest, io);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      io.stdout(PREF_USAGE);
      return 0;
    default:
      io.stderr(`Unknown pref command: ${sub}\n`);
      io.stderr(PREF_USAGE);
      return 1;
  }
}
