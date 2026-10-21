import { realpathSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { observeManagedQualification } from "./qualification-scenarios.js";

// The builtin-only bootstrap installs the lifetime import boundary before this
// fixed module evaluates. This module observes; only its parent's validation
// of a completed process can issue a process-local qualification receipt.
const candidateRoot = realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));
const versions = (JSON.parse(readFileSync(path.join(candidateRoot, "candidate.json"), "utf8"))) as { versions: { core: string; ai: string } };
const observations = await observeManagedQualification();
process.stdout.write(JSON.stringify({ generationId: path.basename(candidateRoot), candidateRoot, versions: versions.versions, observations }) + "\n");
