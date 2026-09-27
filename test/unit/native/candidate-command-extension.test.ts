import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));

async function loadCandidateSurface() {
  const { loadExtensions } = await import(loaderUrl.href);
  const result = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], process.cwd());
  assert.deepEqual(result.errors, []);
  const extension = result.extensions[0];
  const command = extension.commands.get("sparkle-issue-candidate");
  const apply = extension.tools.get("sparkle_apply_candidate").definition;
  assert.ok(command);
  const notices: { text: string; level: string }[] = [];
  const context = {
    hasUI: true,
    ui: { notify: (text: string, level: string) => { notices.push({ text, level }); } }
  };
  return { command, apply, notices, context };
}

test("candidate command preserves quoted Windows handles and rejects malformed overwrites", async () => {
  const { command, apply, notices, context } = await loadCandidateSurface();
  const candidatePath = String.raw`C:\Candidate Work\feature`;
  await command.handler(String.raw`run_report art_report "C:\Candidate Work\feature" "C:\Source Repo" "C:\State Root"`, context);
  assert.equal(notices.at(-1)?.level, "info");

  // Formerly this was five whitespace tokens and could overwrite the handle.
  await command.handler('run_report art_changed "broken /source /state', context);
  assert.equal(notices.at(-1)?.level, "error");

  // The issue triple must still match the original handle exactly. Deliberately
  // refuse on the next check, before importing/applying a candidate or running
  // any verification command. This test never modifies a workspace.
  await assert.rejects(
    () => apply.execute("probe", {
      issue: { runId: "run_report", artifactId: "art_report", candidatePath },
      candidatePath: "deliberately-different"
    }, undefined, undefined, context),
    /^Error: candidatePath does not match the issued handle; refused$/
  );
});

test("malformed candidate command cannot mint an apply handle", async () => {
  const { command, apply, notices, context } = await loadCandidateSurface();
  await command.handler('run_invalid art_invalid "broken /source /state', context);
  assert.equal(notices.at(-1)?.level, "error");
  await assert.rejects(
    () => apply.execute("probe", {
      issue: { runId: "run_invalid", artifactId: "art_invalid", candidatePath: '"broken' },
      candidatePath: '"broken'
    }, undefined, undefined, context),
    /was not issued in this session/
  );
});
