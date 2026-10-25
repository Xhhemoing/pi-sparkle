/** Host-owned aggregate verifier. Recipes are fixed argv data, never worker commands. */
import { pathToFileURL } from "node:url";
import { runAuthorizedCommand } from "../execution/command-runner.js";
import { DEFAULT_RECIPE_OUTPUT_BYTES, DEFAULT_RECIPE_TIMEOUT_MS, prepareWorkItemRecipes, type WorkItemRecipe } from "./work-items.js";

/** Internal checker protocol; never a functional failure or repair grant. */
export const UNSETTLED_RECIPE_EXIT_CODE = 3;
type RecipeOutcome = "accepted" | "failed" | "unavailable";

async function executeRecipes(recipes: readonly WorkItemRecipe[], inheritProcessGroup: boolean, structured = false): Promise<{
  outcome: RecipeOutcome; cleanupUnsettled: boolean;
}> {
  const fixedRecipes = prepareWorkItemRecipes(recipes);
  let accepted = true;
  let unavailable = false;
  let cleanupUnsettled = false;
  const results: { recipeId: string; ok: boolean; status: string; exitCode: number | null; signal: string | null;
    stdoutText: string; stderrText: string; stdoutByteLength: number; stderrByteLength: number; cleanupUnsettled: boolean }[] = [];
  for (const recipe of fixedRecipes) {
    const result = await runAuthorizedCommand({ executable: recipe.command, args: recipe.args, cwd: process.cwd(),
      env: {}, timeoutMs: recipe.timeoutMs ?? DEFAULT_RECIPE_TIMEOUT_MS,
      maxStdoutBytes: recipe.maxStdoutBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES,
      maxStderrBytes: recipe.maxStderrBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES, inheritProcessGroup });
    const ok = result.ok && result.status === "completed" && result.signal === null;
    cleanupUnsettled ||= result.cleanupUnsettled === true;
    results.push({ recipeId: recipe.id, ok, status: result.status, exitCode: result.exitCode, signal: result.signal,
      stdoutText: result.stdoutText, stderrText: result.stderrText, stdoutByteLength: result.stdoutByteLength,
      stderrByteLength: result.stderrByteLength, cleanupUnsettled: result.cleanupUnsettled === true });
    accepted = accepted && ok;
    // Infrastructure failure is not repair feedback. A distinct exit stops the
    // outer loop rather than encouraging a coding retry for an unavailable tool.
    if (result.status !== "completed" || result.signal !== null) { unavailable = true; break; }
  }
  if (structured) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, results, unobserved: fixedRecipes.slice(results.length).map((recipe) => recipe.id) })}\n`);
  } else {
    // The first stored 4 KiB must name every attempted criterion before excerpts.
    process.stdout.write(`${JSON.stringify({ results: results.map(({ stdoutText: _out, stderrText: _err, stdoutByteLength: _outBytes, stderrByteLength: _errBytes, cleanupUnsettled: _cleanup, ...row }) => row),
      unobserved: fixedRecipes.slice(results.length).map((recipe) => recipe.id) })}\n`);
    for (const result of results.filter((row) => !row.ok)) {
      // Compiler/setup chatter often precedes the actionable final error. Keep
      // both ends within a fixed excerpt; the criterion summary stays first.
      const excerpt = (text: string): string => {
        const bytes = Buffer.from(text);
        if (bytes.length <= 1024) return text;
        return `${bytes.subarray(0, 256).toString("utf8")}\n... output omitted ...\n${bytes.subarray(-768).toString("utf8")}`;
      };
      process.stdout.write(`${JSON.stringify({ recipeId: result.recipeId, stdoutText: excerpt(result.stdoutText), stderrText: excerpt(result.stderrText) })}\n`);
    }
  }
  return { outcome: unavailable ? "unavailable" : accepted ? "accepted" : "failed", cleanupUnsettled };
}

export async function checkDevelopmentRecipes(recipes: readonly WorkItemRecipe[]): Promise<RecipeOutcome> {
  return (await executeRecipes(recipes, false)).outcome;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const raw: unknown = JSON.parse(process.argv[2] ?? "null");
    // This entry point is the outer independent check's group leader. Its
    // recipes must remain in that group so abort/deadline reaches the whole
    // cooperative chain. Imported library use retains isolated commands.
    const result = await executeRecipes(raw as readonly WorkItemRecipe[], true, process.argv[3] === "--structured");
    process.exitCode = result.cleanupUnsettled ? UNSETTLED_RECIPE_EXIT_CODE :
      result.outcome === "accepted" ? 0 : result.outcome === "failed" ? 1 : 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
