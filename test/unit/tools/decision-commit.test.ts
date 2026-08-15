import assert from "node:assert/strict";
import { test } from "node:test";

import { DomainValidationError } from "../../../src/domain/errors.js";
import { createTaskId, type TaskId } from "../../../src/domain/ids.js";
import type { FlowchartNodeRole, FlowNode } from "../../../src/domain/flowchart.js";
import type { Event } from "../../../src/run/events.js";
import type { RunCheckpoint } from "../../../src/run/replay.js";
import type { FlowNodeRuntime } from "../../../src/supervisor/flowchart-supervisor.js";
import type { LedgerProgressEntry } from "../../../src/supervisor/ledger.js";
import {
  assembleDecisionCommitInput,
  filterDecisionCommitNodeIds,
  formatCommitMessage,
  generateDecisionCommits,
  gitCommitArgs,
  parseDecisionCommitFile,
  validateDecisionCommitProposal,
  type DecisionCommitInput,
  type DecisionCommitProposal
} from "../../../src/tools/decision-commit.js";

function node(id: string, role: FlowchartNodeRole, objective: string, taskSuffix = id): FlowNode {
  return {
    id,
    taskId: createTaskId(() => taskSuffix),
    role,
    objective,
    modelPolicy: { allowedModels: ["cheap"] },
    confidenceThreshold: 0.7,
    approvalRequired: false
  };
}

function runtime(
  state: FlowNodeRuntime["state"],
  extras: { confidence?: number; model?: string } = {}
): FlowNodeRuntime {
  return {
    state,
    evidenceCount: 0,
    ...(extras.confidence !== undefined ? { confidence: extras.confidence } : {}),
    ...(extras.model !== undefined ? { model: extras.model } : {})
  };
}

function input(partial: {
  nodes: readonly FlowNode[];
  states: Readonly<Record<string, FlowNodeRuntime>>;
  events?: readonly Event[];
  progress?: readonly LedgerProgressEntry[];
  nodeIds?: readonly string[];
  runId?: string;
  objective?: string;
}): DecisionCommitInput {
  return {
    runId: partial.runId ?? "run_commit-bridge",
    objective: partial.objective ?? "Ship the flowchart",
    definition: { nodes: partial.nodes },
    snapshot: {
      nodes: partial.states,
      ledger: {
        progress: [...(partial.progress ?? [])]
      }
    },
    events: partial.events ?? [],
    ...(partial.nodeIds !== undefined ? { nodeIds: partial.nodeIds } : {})
  };
}

function childResultEvent(taskId: TaskId, evidenceIds: readonly string[]): Event {
  return {
    type: "CHILD_MESSAGE",
    payload: {
      message: {
        type: "TASK_RESULT",
        taskId,
        evidenceIds
      }
    }
  } as Event;
}

test("a completed actor node emits feat(nodeId) with evidence ids in the body", () => {
  const actor = node("implement", "actor", "Add the parser");
  const proposals = generateDecisionCommits(
    input({
      nodes: [actor],
      states: { implement: runtime("COMPLETED", { confidence: 0.91, model: "cheap" }) },
      events: [childResultEvent(actor.taskId, ["evd_z", "evd_a"])]
    })
  );
  assert.equal(proposals.length, 1);
  const proposal = proposals[0]!;
  assert.equal(proposal.type, "feat");
  assert.equal(proposal.scope, "implement");
  assert.equal(proposal.subject, "Add the parser");
  assert.deepEqual(proposal.evidenceIds, ["evd_a", "evd_z"]);
  const message = formatCommitMessage(proposal);
  assert.equal(message.split("\n")[0], "feat(implement): Add the parser");
  assert.match(message, /Evidence: evd_a, evd_z/);
  assert.match(message, /Confidence: 0\.91/);
  assert.match(message, /Run: run_commit-bridge/);
  assert.match(message, /Model: cheap/);
});

test("a completed critic node emits fix(scope)", () => {
  const critic = node("review", "critic", "Catch the regressions");
  const [proposal] = generateDecisionCommits(
    input({
      nodes: [critic],
      states: { review: runtime("COMPLETED") },
      progress: [{ round: 1, what: "TASK_COMPLETED", taskId: critic.taskId }]
    })
  );
  assert.ok(proposal);
  assert.equal(proposal.type, "fix");
  assert.equal(proposal.scope, "review");
  assert.match(formatCommitMessage(proposal), /^fix\(review\): Catch the regressions\n/);
  assert.match(formatCommitMessage(proposal), /Evidence: none/);
});

test("skipped and failed nodes are omitted", () => {
  const actor = node("work", "actor", "Do the work");
  const critic = node("review", "critic", "Review the work");
  const judge = node("judge", "judge", "Score the work");
  const proposals = generateDecisionCommits(
    input({
      nodes: [actor, critic, judge],
      states: {
        work: runtime("COMPLETED"),
        review: runtime("SKIPPED"),
        judge: runtime("FAILED")
      }
    })
  );
  assert.deepEqual(
    proposals.map((entry) => entry.nodeId),
    ["work"]
  );
});

test("zero completed nodes throws DomainValidationError", () => {
  assert.throws(
    () =>
      generateDecisionCommits(
        input({
          nodes: [node("work", "actor", "Do the work")],
          states: { work: runtime("SKIPPED") }
        })
      ),
    (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /completed node/i);
      return true;
    }
  );
});

test("a checkpoint without flowchart fails closed", () => {
  const checkpoint = {
    schemaVersion: 1,
    status: "COMPLETED",
    agentOutcomes: [],
    updatedAt: "2026-08-12T09:00:00.000Z"
  } as unknown as RunCheckpoint;
  assert.throws(
    () => assembleDecisionCommitInput(checkpoint, [], "run_commit-bridge"),
    (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /flowchart/i);
      return true;
    }
  );
});

test("the --nodes filter helper rejects unknown ids", () => {
  assert.throws(
    () => filterDecisionCommitNodeIds(["work", "review"], ["work", "mystery"]),
    (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /mystery/);
      return true;
    }
  );
  assert.deepEqual(filterDecisionCommitNodeIds(["work", "review"], ["review"]), ["review"]);
  assert.equal(filterDecisionCommitNodeIds(["work"], undefined), undefined);
});

test("gitCommitArgs includes --allow-empty and -S only when signing", () => {
  const proposal: DecisionCommitProposal = {
    type: "feat",
    scope: "work",
    subject: "Do the work",
    nodeId: "work",
    evidenceIds: [],
    runId: "run_commit-bridge"
  };
  const unsigned = gitCommitArgs(proposal, { sign: false });
  assert.ok(unsigned.includes("--allow-empty"));
  assert.ok(!unsigned.includes("-S"));
  const signed = gitCommitArgs(proposal, { sign: true });
  assert.ok(signed.includes("--allow-empty"));
  assert.ok(signed.includes("-S"));
});

test("edited JSON with invalid type or scope fails closed", () => {
  const valid = {
    commits: [
      {
        type: "feat",
        scope: "work",
        subject: "Do the work",
        nodeId: "work",
        evidenceIds: ["evd_work"],
        runId: "run_commit-bridge"
      }
    ]
  };
  const parsed = parseDecisionCommitFile(JSON.stringify(valid));
  assert.equal(parsed.length, 1);
  assert.equal(validateDecisionCommitProposal(valid.commits[0]!).type, "feat");

  assert.throws(
    () => parseDecisionCommitFile(JSON.stringify({ commits: [{ ...valid.commits[0], type: "nope" }] })),
    DomainValidationError
  );
  assert.throws(
    () => parseDecisionCommitFile(JSON.stringify({ commits: [{ ...valid.commits[0], scope: "bad scope" }] })),
    DomainValidationError
  );
});
