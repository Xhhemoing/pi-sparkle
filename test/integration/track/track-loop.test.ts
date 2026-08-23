import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile  } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import { startTrackedRun } from "../../../src/track/loop.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

test("tracked implementer receives scout artifacts and a grounded prompt", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-ground-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-ground-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }), "utf8");
    const prompts: string[] = [];
    const inner = new ProtocolChildExecutor();
    const executor: AgentExecutor = {
      async *execute(request, signal) {
        prompts.push(request.prompt);
        yield* inner.execute(request, signal);
      }
    };
    const outcome = await startTrackedRun({
      projectRoot,
      objective: "Implement the checkout parser and add tests",
      stateRoot,
      executor,
      primaryModelId: "premium",
      fastModelId: "cheap",
      assumeDefaults: true
    });
    assert.equal(outcome.status, "COMPLETED");
    const requests = outcome.events.filter(
      (event) => event.type === "CHILD_MESSAGE" && event.payload.message.type === "TASK_REQUEST"
    );
    const implement = requests.find((event) => {
      if (event.type !== "CHILD_MESSAGE") return false;
      return event.payload.message.type === "TASK_REQUEST" && /Implement:/i.test(event.payload.message.objective);
    });
    assert.ok(implement);
    assert.ok(implement.type === "CHILD_MESSAGE" && implement.payload.message.type === "TASK_REQUEST");
    assert.ok(implement.payload.message.inputArtifactIds.length > 0);
    assert.ok(prompts.some((prompt) => /Role: implementer/.test(prompt) && /Write access: allowed/.test(prompt)));
    assert.ok(prompts.some((prompt) => /Role: implementer/.test(prompt) && /fake child completed the task/.test(prompt)));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("tracked run with assumed defaults plans, routes, and executes without inventing a policy from selections", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const outcome = await startTrackedRun({
      projectRoot,
      objective: "Implement the checkout parser and add tests",
      stateRoot,
      executor: new ProtocolChildExecutor(),
      primaryModelId: "premium",
      fastModelId: "cheap",
      assumeDefaults: true
    });
    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.split?.source, "primary-schema");
    assert.ok(outcome.assignments.length >= 2);
    const plannerRouted = outcome.events.find(
      (event) => event.type === "MODEL_ROUTED" && event.payload.agentRole === "planner"
    );
    const cheapRouted = outcome.events.find(
      (event) => event.type === "MODEL_ROUTED" && event.payload.model === "cheap"
    );
    assert.ok(plannerRouted);
    if (plannerRouted?.type === "MODEL_ROUTED") {
      assert.equal(plannerRouted.payload.model, "premium");
    }
    assert.ok(cheapRouted);
    assert.ok(outcome.events.some((event) => event.type === "TRACKING_ASSESSMENT"));
    assert.equal(
      outcome.events.some((event) => event.type === "RUN_BLOCKED"),
      false
    );
    const routed = outcome.events.find((event) => event.type === "MODEL_ROUTED");
    assert.ok(routed);
    assert.equal(routed?.type, "MODEL_ROUTED");
    if (routed?.type === "MODEL_ROUTED") {
      assert.ok(routed.payload.behaviorDistribution[routed.payload.model] === 1);
      assert.ok(typeof routed.payload.modelVersion === "string");
      assert.ok(typeof routed.payload.featureVersion === "string");
    }
    assert.equal(outcome.learn?.created, false);
    assert.ok(outcome.checkpoint.flowchart, "track executes through the flowchart supervisor");
    assert.equal(outcome.checkpoint.flowchart?.snapshot.status, "COMPLETED");
    const tester = outcome.events.find(
      (event) =>
        event.type === "MODEL_ROUTED" &&
        event.payload.agentRole === "tester" &&
        event.payload.featureVersion.startsWith("flowchart-")
    );
    assert.ok(tester);
    if (tester?.type === "MODEL_ROUTED") {
      assert.equal(tester.payload.family, "test");
    }
    const requests = outcome.events.filter(
      (event) => event.type === "CHILD_MESSAGE" && event.payload.message.type === "TASK_REQUEST"
    );
    assert.ok(requests.length >= 1);
    for (const event of requests) {
      if (event.type !== "CHILD_MESSAGE" || event.payload.message.type !== "TASK_REQUEST") continue;
      assert.equal(event.payload.message.limits.maxAttempts, 2);
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("tracked routing writes calibrated catalog cost from invocations.jsonl into MODEL_ROUTED", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-cal-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-cal-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      join(stateRoot, "runtime", "invocations.jsonl"),
      `${JSON.stringify({
        id: "inv_cal1",
        taskId: "tsk_prior",
        runId: "run_prior",
        agentInstanceId: "agt_prior",
        config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
        responseHash: "def",
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
        latencyMs: 8_000,
        occurredAt: "2026-08-19T00:00:00.000Z"
      })}\n`,
      "utf8"
    );
    const outcome = await startTrackedRun({
      projectRoot,
      objective: "Implement the checkout parser and add tests",
      stateRoot,
      executor: new ProtocolChildExecutor(),
      primaryModelId: "premium",
      fastModelId: "cheap",
      assumeDefaults: true
    });
    const cheapRouted = outcome.events.filter(
      (event) => event.type === "MODEL_ROUTED" && event.payload.model === "cheap"
    );
    assert.ok(cheapRouted.length >= 1);
    for (const event of cheapRouted) {
      if (event.type !== "MODEL_ROUTED") continue;
      assert.match(event.payload.policyVersion, /calibrated/);
      assert.ok(event.payload.estimatedCostUsd > 0.1);
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("high-risk track arms the human gate then assume-defaults auto-selects it", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-risk-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-risk-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const outcome = await startTrackedRun({
      projectRoot,
      objective: "Deploy payment credentials to production",
      stateRoot,
      executor: new ProtocolChildExecutor(),
      primaryModelId: "premium",
      fastModelId: "cheap",
      assumeDefaults: true
    });
    assert.equal(outcome.status, "COMPLETED");
    assert.ok(outcome.events.some((event) => event.type === "RUN_WAITING_FOR_USER"));
    assert.ok(outcome.events.some((event) => event.type === "USER_ANSWER"));
    const flowchartRoutes = outcome.events.filter(
      (event) =>
        event.type === "MODEL_ROUTED" && event.payload.featureVersion.startsWith("flowchart-")
    );
    assert.ok(flowchartRoutes.length >= 1);
    for (const event of flowchartRoutes) {
      if (event.type !== "MODEL_ROUTED") continue;
      assert.equal(event.payload.highRisk, true);
      assert.equal(event.payload.statusAfterRoute, "WAITING_FOR_USER");
      assert.equal(event.payload.model, "premium");
    }
    const implementer = flowchartRoutes.find(
      (event) => event.type === "MODEL_ROUTED" && event.payload.agentRole === "implementer"
    );
    const reviewer = flowchartRoutes.find(
      (event) => event.type === "MODEL_ROUTED" && event.payload.agentRole === "reviewer"
    );
    assert.ok(implementer, "compiled implementer role must survive flowchart routing");
    assert.ok(reviewer, "compiled reviewer role must survive flowchart routing");
    const consents = outcome.events.filter((event) => event.type === "USER_ANSWER");
    assert.equal(consents.length, 4);
    for (const event of consents) {
      if (event.type !== "USER_ANSWER") continue;
      assert.equal(event.payload.answeredBy, "assume-defaults-auto");
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("cli --track --assume-defaults names auto-cleared high-risk gates", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-gate-cli-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-gate-cli-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { io, out } = capture();
    const code = await withIsolatedPiEnv(() =>
      main(
        [
          "run",
          "--track",
          "--assume-defaults",
          "--executor",
          "fake",
          "--project",
          projectRoot,
          "--objective",
          "Deploy payment credentials to production",
          "--state-root",
          stateRoot
        ],
        io
      )
    );
    assert.equal(code, 0);
    assert.match(out.join(""), /COMPLETED/);
    assert.match(out.join(""), /4 high-risk approval gate\(s\) were auto-cleared by --assume-defaults/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("cli --track without assume-defaults asks clarifying questions for a vague objective", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-cli-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-track-cli-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { io, out } = capture();
    const code = await withIsolatedPiEnv(() =>
      main(
        [
          "run",
          "--track",
          "--project",
          projectRoot,
          "--objective",
          "do it",
          "--state-root",
          stateRoot
        ],
        io
      )
    );
    assert.equal(code, 0);
    assert.match(out.join(""), /WAITING_FOR_USER/);
    assert.match(out.join(""), /clarifying questions/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
