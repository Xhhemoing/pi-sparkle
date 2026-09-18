/**
 * Thin re-export of PS-P4 arm-outcome classification from the built library.
 * Prefer importing `src/experiments/arm-outcome.ts` in unit tests.
 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mod = await import(pathToFileURL(join(repoRoot, "dist", "experiments", "arm-outcome.js")).href);

export const classifyHoldoutBlockEvidenceClass = mod.classifyHoldoutBlockEvidenceClass;
export const classifyArmOutcome = mod.classifyArmOutcome;
export const analyzePairedArms = mod.analyzePairedArms;
