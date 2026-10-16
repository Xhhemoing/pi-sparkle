/** Host-owned aggregate verifier. Recipes are fixed argv data, never worker commands. */
import { pathToFileURL } from "node:url";
import { runAuthorizedCommand } from "../execution/command-runner.js";
import { DEFAULT_RECIPE_OUTPUT_BYTES, DEFAULT_RECIPE_TIMEOUT_MS, prepareWorkItemRecipes, type WorkItemRecipe } from "./work-items.js";

export async function checkDevelopmentRecipes(recipes: readonly WorkItemRecipe[]): Promise<"accepted" | "failed" | "unavailable"> {
  const fixedRecipes = prepareWorkItemRecipes(recipes);
  let accepted = true;
  let unavailable = false;
  const results: { recipeId: string; ok: boolean; status: string; exitCode: number | null; signal: string | null;
    stdoutText: string; stderrText: string }[] = [];
  for (const recipe of fixedRecipes) {
    const result = await runAuthorizedCommand({ executable: recipe.command, args: recipe.args, cwd: process.cwd(),
      env: {}, timeoutMs: recipe.timeoutMs ?? DEFAULT_RECIPE_TIMEOUT_MS,
      maxStdoutBytes: recipe.maxStdoutBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES,
      maxStderrBytes: recipe.maxStderrBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES });
    const ok = result.ok && result.status === "completed" && result.signal === null;
    results.push({ recipeId: recipe.id, ok, status: result.status, exitCode: result.exitCode, signal: result.signal,
      stdoutText: result.stdoutText, stderrText: result.stderrText });
    accepted = accepted && ok;
    // Infrastructure failure is not repair feedback. A distinct exit stops the
    // outer loop rather than encouraging a coding retry for an unavailable tool.
    if (result.status !== "completed" || result.signal !== null) { unavailable = true; break; }
  }
  // The first stored 4 KiB must name every attempted criterion before excerpts.
  process.stdout.write(`${JSON.stringify({ results: results.map(({ stdoutText: _out, stderrText: _err, ...row }) => row),
    unobserved: fixedRecipes.slice(results.length).map((recipe) => recipe.id) })}\n`);
  for (const result of results.filter((row) => !row.ok)) {
    const excerpt = (text: string) => Buffer.from(text).subarray(0, 256).toString("utf8");
    process.stdout.write(`${JSON.stringify({ recipeId: result.recipeId, stdoutText: excerpt(result.stdoutText), stderrText: excerpt(result.stderrText) })}\n`);
  }
  if (unavailable) return "unavailable";
  return accepted ? "accepted" : "failed";
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const raw: unknown = JSON.parse(process.argv[2] ?? "null");
    const result = await checkDevelopmentRecipes(raw as readonly WorkItemRecipe[]);
    process.exitCode = result === "accepted" ? 0 : result === "failed" ? 1 : 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
