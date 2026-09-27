import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  disableModel,
  enableModel,
  providersConfigPath,
  saveProvidersConfig,
  setDefaultModels
} from "../../../src/config/providers-config.js";

export type ConfigMutation =
  | { readonly kind: "enable"; readonly id: string }
  | { readonly kind: "disable"; readonly id: string }
  | { readonly kind: "replace"; readonly enabled: readonly string[] }
  | { readonly kind: "defaults"; readonly primary: string; readonly fast: string };

export async function applyConfigMutation(stateRoot: string, mutation: ConfigMutation): Promise<void> {
  if (mutation.kind === "enable") await enableModel(stateRoot, mutation.id);
  else if (mutation.kind === "disable") await disableModel(stateRoot, mutation.id);
  else if (mutation.kind === "replace") await saveProvidersConfig(stateRoot, { version: 1, enabled: mutation.enabled, customProviders: [] });
  else await setDefaultModels(stateRoot, mutation);
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Keep every filesystem operation real; control only when the first fsynced temp is published. */
export function installConfigIoBarrier(stateRoot: string, pauseWrite: boolean) {
  const configPath = providersConfigPath(stateRoot);
  const staged = deferred();
  const released = deferred();
  let accessed = deferred();
  let paused = false;
  const originalOpen = fs.open;
  const originalReadFile = fs.readFile;

  fs.open = async (...args: Parameters<typeof fs.open>) => {
    try {
      const handle = await originalOpen(...args);
      if (!paused && pauseWrite && String(args[0]).startsWith(`${configPath}.`) && String(args[0]).endsWith(".tmp")) {
        paused = true;
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          await sync();
          staged.resolve();
          await released.promise;
        };
      }
      return handle;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (String(args[0]) === `${configPath}.lock` && ["EEXIST", "EPERM", "EACCES"].includes(code ?? "")) {
        accessed.resolve();
      }
      throw error;
    }
  };
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    const result = await originalReadFile(...args);
    if (String(args[0]) === configPath) accessed.resolve();
    return result;
  }) as typeof fs.readFile;
  syncBuiltinESMExports();

  return {
    staged: staged.promise,
    release: released.resolve,
    nextAccess(): Promise<void> {
      accessed = deferred();
      return accessed.promise;
    },
    restore(): void {
      fs.open = originalOpen;
      fs.readFile = originalReadFile;
      syncBuiltinESMExports();
    }
  };
}

if (process.argv[2] === "providers-config-worker") {
  const stateRoot = process.argv[3]!;
  const mutation = JSON.parse(process.argv[4]!) as ConfigMutation;
  const paused = process.argv[5] === "pause";
  const barrier = installConfigIoBarrier(stateRoot, paused);
  if (paused) {
    process.on("message", (message) => { if (message === "release") barrier.release(); });
    void barrier.staged.then(() => process.send?.("staged"));
  } else {
    void barrier.nextAccess().then(() => process.send?.("accessed"));
  }
  try {
    await applyConfigMutation(stateRoot, mutation);
    process.send?.("done");
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    barrier.restore();
    process.disconnect?.();
  }
}
