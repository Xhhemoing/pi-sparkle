// Actual fresh-process entry: only builtins and the builtin-only bootstrap may
// evaluate before loadManagedCandidateEntry installs the lifetime boundary.
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { loadManagedCandidateEntry } from "./bootstrap.js";

const controller = new AbortController();
const stop = (): void => controller.abort();
process.on("message", (message: unknown) => {
  if (message !== null && typeof message === "object" && "type" in message && message.type === "stop") stop();
});
process.on("disconnect", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (!process.connected) stop();

async function run(): Promise<void> {
  const [managerRoot, expectedRoot, generationId, core, ai, rawArgv] = process.argv.slice(2);
  if (managerRoot === undefined || expectedRoot === undefined || generationId === undefined || core === undefined || ai === undefined || rawArgv === undefined ||
      Buffer.byteLength(rawArgv, "utf8") > 32 * 1024) throw new Error("invalid fixed managed driver launch");
  const ownFile = realpathSync.native(fileURLToPath(import.meta.url));
  const root = realpathSync.native(path.resolve(path.dirname(ownFile), "../../../.."));
  if (root !== expectedRoot || path.basename(root) !== generationId || ownFile !== path.join(root, "app/dist/pi-adapter/managed/driver-entry.js") ||
      process.argv[1] === undefined || realpathSync.native(process.argv[1]) !== ownFile) throw new Error("managed driver actual entry identity mismatch");
  const argv: unknown = JSON.parse(rawArgv);
  if (!Array.isArray(argv) || !argv.every((item) => typeof item === "string") || !["run", "resume"].includes(argv[0] as string)) throw new Error("invalid fixed managed application arguments");
  // Bootstrap's script guard is false (argv[1] is this entry), so the bootstrap
  // module has completed evaluation before this await; there is no TLA cycle.
  const application = await loadManagedCandidateEntry(root, "cli/main.js", { core, ai });
  const { ManagedGenerationStore } = await import("./generation-store.js");
  const store = new ManagedGenerationStore(managerRoot);
  const qualified = await store.getQualifiedGeneration(generationId);
  if (qualified.root !== root || qualified.appRoot !== path.join(root, "app") || qualified.generationId !== generationId ||
      !isDeepStrictEqual(qualified.versions, { core, ai })) throw new Error("managed driver qualified identity mismatch");
  const binding = Object.freeze({ kind: "managed-pi" as const, generationId });
  const engineContext = Object.freeze({ binding, assertQualifiedGeneration: async (requested: typeof binding): Promise<void> => {
    if (!isDeepStrictEqual(requested, binding)) throw new Error("managed driver generation cannot change");
    await store.getQualifiedGeneration(generationId);
  } });
  if (typeof application.main !== "function") throw new Error("managed application main is missing");
  const main = application.main as typeof import("../../cli/main.js").main;
  const code = await main(argv, { stdout: (value) => { process.stdout.write(value); }, stderr: (value) => { process.stderr.write(value); } }, { engineContext, signal: controller.signal });
  // The receipt follows actual application/adapter/child and telemetry settlement.
  if (!process.connected || process.send === undefined) throw new Error("managed parent disconnected; application settled without receipt");
  await new Promise<void>((resolve, reject) => process.send!({ type: "settled", generationId, root, entry: ownFile, versions: { core, ai }, code, stopped: controller.signal.aborted }, (error: Error | null) => error === null ? resolve() : reject(error)));
  process.exitCode = code;
}

try { await run(); }
catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  process.removeListener("disconnect", stop);
  if (process.connected) process.disconnect?.();
}
