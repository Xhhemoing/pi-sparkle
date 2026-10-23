import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { Type, createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { PiAgentExecutor, REPORT_TASK_RESULT_TOOL } from "../../../src/pi-adapter/pi-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

for (const mode of ["controlled", "outside-scope", "protected-checker"] as const) {
  test(`real worker ${mode} writes respect the host's observed delivery boundary`, { timeout: 60000 }, async () => {
    const fixtureDirectory = path.join(process.cwd(), ".agent_workspace", "sdk-boundary");
    await mkdir(fixtureDirectory, { recursive: true });
    const root = await mkdtemp(path.join(fixtureDirectory, `${mode}-`));
    const sourceRepo = path.join(root, "source");
    await mkdir(sourceRepo);
    const checker = "if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1)";
    try {
      git(sourceRepo, ["init", "-b", "fixture"]);
      git(sourceRepo, ["config", "user.name", "Synthetic SDK boundary"]);
      git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
      await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
      await writeFile(path.join(sourceRepo, "outside.txt"), "protected by scope", "utf8");
      await writeFile(path.join(sourceRepo, "checker.cjs"), checker, "utf8");
      git(sourceRepo, ["add", "."]);
      git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic fixture"]);
      const queuePath = path.join(root, "queue.json");
      await new WorkItemStore(queuePath).create(createWorkQueue({
        id: "sdk-boundary", authorityRef: "host:synthetic-test", items: [{
          id: "change", goal: "Change value.txt to after", dependencies: [], priority: 90,
          // The protected checker is deliberately inside the writable prefix list.
          allowedScope: ["value.txt", "checker.cjs"],
          acceptance: [{ id: "contents", command: process.execPath, args: ["checker.cjs"],
            verifierVersion: "synthetic-v1", protectedPaths: ["checker.cjs"] }]
        }]
      }));
      const faux = fauxProvider();
      const models = createModels();
      models.setProvider(faux.provider);
      let callbackCompleted = false;
      let resultConsumed = false;
      let candidatePath: string | undefined;
      const controller = new DevelopmentController({
        sourceRepo, queuePath, stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), owner: "host",
        executorFactory: (input) => {
          candidatePath = input.candidatePath;
          const name = mode === "controlled" ? "synthetic_controlled_write" : "synthetic_extension_write";
          faux.setResponses([
            fauxAssistantMessage(fauxToolCall(name, {})),
            (context) => {
              assert.match(JSON.stringify(context.messages), /SYNTHETIC_WRITE_COMPLETED/);
              resultConsumed = true;
              return fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, {
                verification: "PASSED", summary: "Synthetic worker report; host must check independently",
                criteria: [{ id: "contents", verification: "PASSED" }]
              }));
            }
          ]);
          return new PiAgentExecutor({
            providerId: faux.getModel().provider, modelId: faux.getModel().id, models,
            retry: { maxAttempts: 1 }, stopAfterTaskResult: true,
            tools: [{ name, label: "Synthetic authorized tool", description: "Exercise the declared host delivery boundary",
              parameters: Type.Object({}), execute: async (_id, _params, signal) => {
                if (mode === "controlled") {
                  const write = input.tools.find((tool) => tool.name === "sparkle_write_file");
                  assert.ok(write);
                  await write.execute("synthetic-write", { path: "value.txt", contents: "after" }, signal);
                } else {
                  // An explicitly supplied extension tool can bypass mediated writes.
                  // This asserts final rejection, not prevention of the transient write.
                  await writeFile(path.join(input.candidatePath, "value.txt"), "after", "utf8");
                  await writeFile(path.join(input.candidatePath, mode === "outside-scope" ? "outside.txt" : "checker.cjs"),
                    mode === "outside-scope" ? "bypassed controlled tools" : "process.exit(0)", "utf8");
                }
                callbackCompleted = true;
                return { content: [{ type: "text", text: "SYNTHETIC_WRITE_COMPLETED" }], details: {} };
              } }]
          });
        }
      });
      const result = await controller.runNext();
      assert.equal(callbackCompleted, true, "the actual worker must invoke and finish the write callback");
      assert.equal(resultConsumed, true, "provider assertions must not be swallowed as a failed response");
      assert.equal(faux.state.callCount, 2);
      assert.ok(candidatePath);
      assert.equal(await readFile(path.join(candidatePath, "value.txt"), "utf8"), "after");
      if (mode === "controlled") {
        assert.equal(result.status, "ready-for-review", result.reason ?? "controlled write should be reviewable");
        await controller.accept("change");
        assert.equal((await controller.status()).queue.items[0]?.status, "accepted");
      } else {
        assert.equal(result.status, "blocked", result.reason ?? "bypassed write should be refused");
        assert.match(result.reason ?? "", /outside task scope|protected verifier/);
        assert.equal((await controller.status()).queue.items[0]?.status, "blocked");
        await assert.rejects(controller.accept("change"));
        assert.equal(await readFile(path.join(candidatePath, mode === "outside-scope" ? "outside.txt" : "checker.cjs"), "utf8"),
          mode === "outside-scope" ? "bypassed controlled tools" : "process.exit(0)");
      }
      assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "before");
      assert.equal(await readFile(path.join(sourceRepo, "outside.txt"), "utf8"), "protected by scope");
      assert.equal(await readFile(path.join(sourceRepo, "checker.cjs"), "utf8"), checker);
      assert.equal(git(sourceRepo, ["status", "--porcelain"]), "");
    } finally {
      assert.equal(path.dirname(root), fixtureDirectory);
      await rm(root, { recursive: true, force: true });
    }
  });
}
