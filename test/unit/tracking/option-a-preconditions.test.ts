import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { AGENT_ROLES, type AgentRole } from "../../../src/domain/roles.js";
import type { AgentInstanceId, ArtifactId, EvidenceId, RunId, TaskId } from "../../../src/domain/ids.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import { validateConfidenceScore, type Flowchart } from "../../../src/domain/flowchart.js";
import { createTaskResultTool } from "../../../src/pi-adapter/pi-executor.js";
import { VERIFICATION_KINDS, validateAgentMessage, type TaskResult } from "../../../src/protocol/v1.js";
import type { ChildRunOutcome, ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { observationFromChild } from "../../../src/run/child-tracking.js";
import { validateFlowchartCheckpointState } from "../../../src/run/replay.js";
import { createFlowchartSupervisor } from "../../../src/supervisor/flowchart-supervisor.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import { combineScore } from "../../../src/tracking/combined-score.js";
import { DEFAULT_TRACKING_CONFIG } from "../../../src/tracking/config.js";
import { evaluateGates } from "../../../src/tracking/gates.js";
import { computePrescore, isSuccessClaim } from "../../../src/tracking/prescore.js";
import { runTrackingTurn } from "../../../src/tracking/turn.js";
import {
  assessChildObservation,
  prescoreInputFromObservation,
  type ChildObservation,
  type ObservedChildOutcome
} from "../../../src/tracking/from-child.js";
import { parseTrackingAssessment, type ConstraintRecord } from "../../../src/tracking/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Loop 4 R8-4 — the preconditions option (a) had to satisfy. Option (a)
 * shipped at R11-1, so this file is now the record of what moved.
 *
 * All five pins have been through the replace-in-the-same-diff rule R8-4 wrote
 * for them, in two instalments: pin 2 at R9-2 (the child-side verdict
 * producer), the remaining four here. Each still measures the fact it was
 * written to measure; what changed is the answer, and where the answer changed
 * the pin says so rather than being deleted. R10-2's exact-title meta-pin moved
 * with them — it now protects the post-option-(a) titles.
 *
 * What did *not* move is worth naming, because reading this file the other way
 * round is easy: acceptance criteria are still not scored. `check-coverage`
 * still has no FAIL in its range, `completedChecks` is still an echo of the
 * request, and the 270-cell sweep in `criteria-are-guidance.test.ts` still
 * holds — a criterion the caller *asked for* moves nothing. What gates is a
 * criterion the child *reported* FAILED, through one named anomaly with that
 * criterion's own evidence behind it.
 */

const REGISTRY = createAgentProfileRegistry(defaultAgentProfiles());
const CHILD_RUN_ID = "run_01234567-89ab-cdef-0123-456789abcdef" as RunId;
const TASK_ID = "tsk_01234567-89ab-cdef-0123-456789abcdef" as TaskId;
const EVIDENCE_ID = "evd_01234567-89ab-cdef-0123-456789abcdef" as EvidenceId;
const ARTIFACT_ID = "art_01234567-89ab-cdef-0123-456789abcdef" as ArtifactId;

function specFor(role: AgentRole, criterionIds: readonly string[]): ChildTaskInput {
  return {
    taskId: TASK_ID,
    role,
    objective: `Do ${role} work`,
    profile: REGISTRY.resolve(role),
    inputArtifactIds: [],
    acceptanceCriteria: criterionIds.map((id) => ({ id, description: `criterion ${id}` })),
    limits: { maxAttempts: 1, timeoutMs: 30_000, maxWallTimeMs: 300_000 }
  };
}

const AGENT_ID = "agt_01234567-89ab-cdef-0123-456789abcdef" as AgentInstanceId;
const OTHER_TASK_ID = "tsk_fedcba98-7654-3210-fedc-ba9876543210" as TaskId;

/**
 * The smallest restorable flowchart checkpoint payload, built live rather than
 * hand-written because `validateFlowchartCheckpointState` validates by restore
 * and a hand-written snapshot would fail before reaching the field under test.
 */
const FLOWCHART_LIMITS = { maxConcurrentNodes: 4, maxConsecutiveStalls: 3 };
const FLOWCHART_DEFINITION: Flowchart = {
  id: "criteria-seam",
  nodes: [
    {
      id: "a",
      taskId: TASK_ID,
      role: "actor",
      objective: "Do a",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: validateConfidenceScore(0.7),
      approvalRequired: false
    }
  ],
  edges: []
};
const FLOWCHART_SNAPSHOT = createFlowchartSupervisor({
  flowchart: FLOWCHART_DEFINITION,
  router: createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor", "critic"],
        maxComplexity: "MEDIUM",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000
      }
    ]
  })
}).snapshot();

/**
 * Drives the shipped `sparkle_report_task_result` tool and returns the message
 * it really emitted, so the pin below scores an executor-authored verdict
 * rather than a hand-written lookalike.
 */
async function reportedTerminal(args: Record<string, unknown>): Promise<TaskResult> {
  const emitted: ExecutionEvent[] = [];
  const request = {
    runId: CHILD_RUN_ID,
    taskId: TASK_ID,
    agentInstanceId: AGENT_ID,
    prompt: "Do the work",
    workingDirectory: "/tmp/project"
  } satisfies AgentExecutionRequest;
  await createTaskResultTool(request, (event) => emitted.push(event)).execute("tool_call_1", args);
  const message = emitted[0];
  assert.ok(message?.type === "MESSAGE" && message.message.type === "TASK_RESULT");
  return validateAgentMessage(message.message) as TaskResult;
}

/**
 * The child run the coordinator builds around a terminal it accepted:
 * `outcome`/`summary` come from the terminal (`child-coordinator.ts:529-530`)
 * and the id lists from the same message (`:570-571`).
 */
function childReporting(terminal: TaskResult): ChildRunOutcome {
  return {
    childRunId: CHILD_RUN_ID,
    taskId: TASK_ID,
    outcome: terminal.outcome,
    attempts: 1,
    summary: terminal.summary,
    messages: [terminal],
    artifactIds: terminal.artifactIds,
    evidenceIds: terminal.evidenceIds,
    terminalResult: terminal
  } as unknown as ChildRunOutcome;
}

/**
 * A child whose work passed as a whole and which named one criterion it did
 * not meet — the case the per-criterion channel exists for, and the one no
 * whole-task verdict can express.
 */
function childReportingUnmetCriterion(): ChildRunOutcome {
  return {
    ...childOutcome("PASSED"),
    terminalResult: {
      verification: {
        kind: "PASSED",
        evidenceIds: [EVIDENCE_ID],
        criteria: [{ id: "crit-a", kind: "FAILED", evidenceIds: [EVIDENCE_ID] }]
      }
    }
  } as unknown as ChildRunOutcome;
}

function childOutcome(kind: "PASSED" | "FAILED"): ChildRunOutcome {
  return {
    childRunId: CHILD_RUN_ID,
    taskId: TASK_ID,
    outcome: "SUCCESS",
    attempts: 1,
    summary: "did the work",
    messages: [],
    artifactIds: [ARTIFACT_ID],
    evidenceIds: [EVIDENCE_ID],
    terminalResult: { verification: { kind, evidenceIds: [EVIDENCE_ID] } }
  } as unknown as ChildRunOutcome;
}

describe("what a criteria-gating design had to move (option (a), landed)", () => {
  it("keeps the landed option (a) pins 1, 3, 4, and 5 named exactly", async () => {
    // R10-2's meta-pin, re-pointed at the titles those four pins carry now
    // that option (a) has landed. Its job is unchanged: a later slot that
    // wants to weaken one of them has to rename it here first, in the open.
    const source = await readFile(fileURLToPath(import.meta.url), "utf8");
    const declaredTitles = [...source.matchAll(/^\s*it\("([^"]+)"/gm)].map((match) => match[1]);
    const protectedTitles = [
      "criteria reach the prescore for exactly one role, and the gate for all of them",
      "scoring the capped prescore would move 54 of 270 cells, none of them about criteria",
      "the recorded assessment vocabulary names exactly one criterion-shaped anomaly code",
      "the protocol carries one verdict per task, and that verdict can speak per criterion"
    ];

    for (const title of protectedTitles) {
      assert.ok(declaredTitles.includes(title), `R8-4 protected pin is missing or renamed: ${title}`);
    }
  });

  it("criteria reach the prescore for exactly one role, and the gate for all of them", () => {
    // `observationFromChild` is where a task's acceptance criteria become
    // `requiredChecks`, and it consults the role first: a non-tester child's
    // criteria are dropped before the prescore ever sees them, so
    // check-coverage reads NOT_APPLICABLE for six of the seven roles however
    // many criteria the caller wrote. A per-criterion channel that only a
    // tester's result can be scored against is a role decision as well as a
    // protocol one.
    const withCriteria = new Map<AgentRole, readonly string[]>();
    for (const role of AGENT_ROLES) {
      const observation = observationFromChild(childOutcome("PASSED"), specFor(role, ["crit-a", "crit-b"]));
      withCriteria.set(role, observation.requiredChecks);
    }
    assert.deepEqual(
      Object.fromEntries([...withCriteria].filter(([, checks]) => checks.length > 0)),
      { tester: ["crit-a", "crit-b"] },
      "only a tester child's acceptance criteria become required checks"
    );

    // And a tester with no criteria at all gets a synthetic one, so the
    // dimension is applicable for every tester and for no one else.
    const bare = observationFromChild(childOutcome("PASSED"), specFor("tester", []));
    assert.deepEqual(bare.requiredChecks, ["test"]);
    const dimensionOf = (observation: ChildObservation): string | undefined =>
      computePrescore(prescoreInputFromObservation(observation)).dimensions.find(
        (entry) => entry.id === "check-coverage"
      )?.outcome;
    assert.equal(dimensionOf(bare), "PASS");
    assert.equal(
      dimensionOf(observationFromChild(childOutcome("PASSED"), specFor("implementer", ["crit-a"]))),
      "NOT_APPLICABLE"
    );

    // The half option (a) changed. The role gate above is a *prescore* fact:
    // it decides whose asked-for criteria become `requiredChecks`. A criterion
    // the child reported FAILED never travels that way — it arrives on the
    // verdict — so it gates every role, including the six whose criteria
    // check-coverage still refuses to look at.
    const codesByRole = new Map<AgentRole, string>();
    for (const role of AGENT_ROLES) {
      const decision = assessChildObservation({
        observation: observationFromChild(childReportingUnmetCriterion(), specFor(role, ["crit-a"])),
        episodeId: "ep_probe",
        runId: "run_probe"
      });
      assert.equal(decision.apply, true, role);
      if (!decision.apply) return;
      codesByRole.set(role, decision.assessment.gate.codes.join(","));
    }
    assert.deepEqual(
      [...new Set(codesByRole.values())],
      ["unmet-acceptance-criterion"],
      "a reported unmet criterion blocks every role, not only the tester whose criteria are scored"
    );
    assert.equal(
      dimensionOf(observationFromChild(childReportingUnmetCriterion(), specFor("implementer", ["crit-a"]))),
      "NOT_APPLICABLE",
      "and it does so without the criteria-shaped dimension learning anything"
    );
  });

  it("the real executor now produces the verdict the gate admits on; silence still does not", async () => {
    // Loop 4 R9-2 replaced this pin, as R8-4 required: the census is
    // re-derived, not deleted. Its finding has inverted. `PiAgentExecutor`
    // gained `sparkle_report_task_result`, a per-request tool of the
    // `createClusterTools` shape that emits a real protocol-v1 TASK_RESULT
    // into the attempt transcript, so `finish` replays the child's verdict
    // instead of synthesizing UNOBSERVED. The gate therefore has a live
    // producer for the first time — but only when the child calls the tool.
    // Re-derive again when a producer ships or moves; do not delete.
    const files = await typeScriptFilesUnder(join(REPO_ROOT, "src"));
    const producers = new Map<string, string[]>();
    let piMessages = 0;
    for (const file of files) {
      const relative = file.slice(REPO_ROOT.length);
      // Comments discuss these shapes (`flowchart-run.ts` explains why a
      // FAILED verdict blocks a run); only code produces one. A producer whose
      // kind is decided at runtime writes it as a shorthand property, so the
      // census records that as `<runtime>` rather than missing it.
      const code = (await readFile(file, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const match of code.matchAll(
        /verification:\s*\{\s*kind\s*(?::\s*"(PASSED|FAILED|UNOBSERVED)")?\s*[,}]/g
      )) {
        producers.set(relative, [...(producers.get(relative) ?? []), match[1] ?? "<runtime>"]);
      }
      if (relative === "src/pi-adapter/pi-executor.ts") {
        piMessages = [...code.matchAll(/type:\s*"MESSAGE"/g)].length;
      }
    }
    assert.deepEqual(
      Object.fromEntries([...producers].toSorted()),
      {
        "src/cli/main.ts": ["PASSED"],
        "src/pi-adapter/pi-executor.ts": ["<runtime>", "UNOBSERVED"],
        "src/testing/fake-executor.ts": ["PASSED"]
      },
      "the two fakes still hard-code PASSED; the real executor reports or falls back to UNOBSERVED"
    );
    assert.equal(
      piMessages,
      2,
      "the pi adapter emits two protocol messages: the child's verdict and the terminal it synthesizes when there is none"
    );

    // The behavioural half, on messages the adapter really produced.
    const reported = await reportedTerminal({
      verification: "PASSED",
      summary: "ran the suite",
      evidenceIds: [EVIDENCE_ID],
      artifactIds: [ARTIFACT_ID]
    });
    const passed = assessChildObservation({
      observation: observationFromChild(childReporting(reported), specFor("tester", ["crit-a"])),
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    assert.equal(passed.apply, true, "a child-authored PASSED verdict is scored");
    if (!passed.apply) return;
    assert.equal(passed.turn.gate.kind, "none");

    const failedTerminal = await reportedTerminal({
      verification: "FAILED",
      summary: "two assertions still fail",
      evidenceIds: [EVIDENCE_ID]
    });
    const failed = assessChildObservation({
      observation: observationFromChild(childReporting(failedTerminal), specFor("tester", ["crit-a"])),
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    assert.equal(failed.apply, true);
    if (!failed.apply) return;
    assert.deepEqual(
      failed.turn.gate.codes,
      ["deterministic-fail"],
      "the hard gate the codebase already ships is reachable for --executor pi for the first time"
    );

    // C6, re-checked against real inputs instead of prose. A real verdict does
    // make `claimed-verification-without-checks` reachable, but only where
    // R8-4 predicted: on FAILED (PASSED still echoes completedChecks, so the
    // gap cannot open) and only when the child's own summary trips
    // `isSuccessClaim`. `deterministic-fail` still leads, so the transition's
    // reasonCode is unchanged and this stays a second code, never the first.
    const boasting = await reportedTerminal({
      verification: "FAILED",
      summary: "the suite passed except for two assertions",
      evidenceIds: [EVIDENCE_ID]
    });
    const claimed = assessChildObservation({
      observation: observationFromChild(childReporting(boasting), specFor("tester", ["crit-a"])),
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    assert.equal(claimed.apply, true);
    if (!claimed.apply) return;
    assert.deepEqual(claimed.turn.gate.codes, [
      "deterministic-fail",
      "claimed-verification-without-checks"
    ]);

    // The default path is unchanged: a child that reports nothing still gets
    // the synthesized UNOBSERVED terminal, and UNOBSERVED is not scored at
    // all. Producing a verdict is now possible, not mandatory.
    const synthesized: ChildObservation = {
      taskId: "tsk_probe",
      role: "tester",
      outcome: "SUCCESS",
      summary: "pi agent finished",
      evidenceIds: [],
      artifactIds: [],
      verification: { kind: "UNOBSERVED", evidenceIds: [] },
      requiredChecks: ["crit-a"],
      constraints: []
    };
    assert.equal(
      assessChildObservation({ observation: synthesized, episodeId: "ep_probe", runId: "run_probe" }).apply,
      false,
      "an UNOBSERVED verdict is not scored at all, so nothing downstream of it runs"
    );

    // And the tool's evidence requirement is load-bearing rather than
    // decorative: an unreferenced FAILED verdict is discarded here, before the
    // gate, so refusing it at the producer is what keeps it from vanishing.
    assert.equal(
      assessChildObservation({
        observation: { ...synthesized, verification: { kind: "FAILED", evidenceIds: [] }, evidenceIds: [] },
        episodeId: "ep_probe",
        runId: "run_probe"
      }).apply,
      false,
      "a FAILED verdict citing nothing never reaches the gate"
    );
  });

  it("scoring the capped prescore would move 54 of 270 cells, none of them about criteria", () => {
    // R7-2 §7.3's separate question, measured instead of argued. `turn.ts`
    // scores the uncapped `P`; `cappedByHardFail` reaches `displayPrescore`
    // only. Feeding the gate the capped value instead is the "cap-to-gate"
    // option for making a criteria FAIL bite — and this is its real blast
    // radius: every cell it moves is a child whose verifier PASSED while its
    // own reported outcome was FAILURE or TIMEOUT, which is `progress-vs-stall`
    // failing, not a criterion. Criteria move nothing either way.
    const current: string[] = [];
    const moved: string[] = [];
    let cells = 0;
    for (const behaviour of BEHAVIOURS) {
      for (const requiredChecks of CRITERIA_VARIANTS) {
        for (const constraints of CONSTRAINT_VARIANTS) {
          cells += 1;
          const observation = observationOf(behaviour, requiredChecks, constraints);
          const input = prescoreInputFromObservation(observation);
          const prescore = computePrescore(input);
          const facts = {
            human: { kind: "unobserved" } as const,
            config: DEFAULT_TRACKING_CONFIG,
            deterministicFail: behaviour.kind === "FAILED",
            ownershipEscape: false,
            claimedVerificationWithoutChecks:
              input.claims.some(isSuccessClaim) &&
              input.requiredChecks.length > 0 &&
              !input.requiredChecks.every((check) => input.completedChecks.includes(check)),
            // No cell in this grid reports a per-criterion outcome, which is
            // why the count below is unchanged by option (a): the sweep
            // measures criteria that were *asked for*.
            criterionUnmet: false,
            repeatedNoProgress: false,
            userRejectStop: false,
            safetyRejected: false,
            openMinors: []
          };
          const scored = (P: number) =>
            evaluateGates({
              ...facts,
              P,
              score: combineScore({ P, human: facts.human, obviousProblem: false })
            });
          const asShipped = scored(prescore.P);
          const asCapped = scored(prescore.displayPrescore);

          // The direct call must reproduce production exactly, or the
          // counterfactual below compares against a straw man.
          const turn = runTrackingTurn({
            window: {
              contextFacts: [],
              toolSituations: input.toolSituations,
              constraints: input.constraints,
              unresolvedDecisions: [],
              confirmedDecisions: [],
              openMinors: []
            },
            prescoreInput: input,
            humanInput: {},
            gateFacts: { deterministicFail: behaviour.kind === "FAILED" }
          });
          assert.equal(asShipped.kind, turn.gate.kind, behaviour.label);
          assert.deepEqual(asShipped.codes, turn.gate.codes, behaviour.label);

          const label = `${behaviour.label} +${requiredChecks.length}crit +${constraints.length}con`;
          current.push(`${label} => ${asShipped.kind}`);
          if (asShipped.kind === asCapped.kind) continue;
          moved.push(label);
          assert.equal(asShipped.kind, "none", label);
          assert.equal(asCapped.kind, "soft", label);
          assert.deepEqual(asCapped.codes, ["soft-threshold"], label);
          assert.equal(behaviour.kind, "PASSED", label);
          assert.ok(
            behaviour.outcome === "FAILURE" || behaviour.outcome === "TIMEOUT",
            `${label} moved for a reason other than progress-vs-stall`
          );
        }
      }
    }
    assert.equal(cells, 270);
    assert.equal(moved.length, 54, "cap-to-gate is not criteria-shaped: it moves progress cells");
    assert.equal(
      new Set(current.filter((entry) => entry.endsWith("=> none"))).size > 0,
      true,
      "the sweep is not vacuous: some cells are open today"
    );
  });

  it("the recorded assessment vocabulary names exactly one criterion-shaped anomaly code", () => {
    // R8-4's pin 4, replaced as it required. It used to assert that no
    // criterion-shaped code existed; option (a) added exactly one, so the
    // tripwire now holds the vocabulary at that one. The two near-misses it
    // already refused are still refused, which is what keeps a second,
    // undeclared spelling from creeping in beside the first.
    const decision = assessChildObservation({
      observation: {
        taskId: "tsk_probe",
        role: "tester",
        outcome: "SUCCESS",
        summary: "did the work",
        evidenceIds: [EVIDENCE_ID],
        artifactIds: [ARTIFACT_ID],
        verification: { kind: "PASSED", evidenceIds: [EVIDENCE_ID] },
        requiredChecks: ["crit-a"],
        constraints: []
      },
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    assert.equal(decision.apply, true);
    if (!decision.apply) return;
    const record = JSON.parse(JSON.stringify(decision.assessment)) as {
      gate: { codes: string[] };
    };

    record.gate.codes = ["soft-threshold"];
    assert.deepEqual(parseTrackingAssessment(record).gate.codes, ["soft-threshold"]);

    record.gate.codes = ["unmet-acceptance-criterion"];
    assert.deepEqual(parseTrackingAssessment(record).gate.codes, ["unmet-acceptance-criterion"]);

    for (const candidate of ["criteria-unmet", "acceptance-criterion-fail"]) {
      record.gate.codes = [candidate];
      assert.throws(
        () => parseTrackingAssessment(record),
        (error: unknown) => error instanceof DomainValidationError && /gate\.codes\[0\] is invalid/.test(error.message),
        `${candidate} is not in the recorded vocabulary`
      );
    }

    // The vocabulary is one thing; a real assessment carrying the code is
    // another. This one comes off the production path, so the persisted record
    // is proven parseable rather than assumed to be.
    const blocked = assessChildObservation({
      observation: observationFromChild(childReportingUnmetCriterion(), specFor("tester", ["crit-a"])),
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    assert.equal(blocked.apply, true);
    if (!blocked.apply) return;
    const persisted = parseTrackingAssessment(JSON.parse(JSON.stringify(blocked.assessment)));
    assert.deepEqual(persisted.gate.codes, ["unmet-acceptance-criterion"]);
    assert.equal(persisted.gate.kind, "hard");
    assert.ok(
      persisted.evidenceRefs.includes(EVIDENCE_ID),
      "the criterion's own evidence reaches the record, so the anomaly is auditable"
    );
  });

  it("the protocol carries one verdict per task, and that verdict can speak per criterion", async () => {
    // R8-4's pin 5, replaced. Its starting state was three verdict kinds, one
    // verdict object, two fields on it, and a `criteria` key that validated
    // only because protocol v1 tolerates unknown keys — additive, and unread.
    // Option (a) declared the field, so the same message is now read. Still
    // one verdict object and still three kinds: the channel let the verifier
    // say more in one statement, not say it more often.
    assert.deepEqual([...VERIFICATION_KINDS], ["PASSED", "FAILED", "UNOBSERVED"]);

    const source = await readFile(join(REPO_ROOT, "src/protocol/v1.ts"), "utf8");
    const region = /export interface VerificationResult \{([\s\S]*?)\n\}/.exec(source);
    assert.ok(region, "VerificationResult must stay a declared interface");
    const fields = [...(region[1] ?? "").matchAll(/^\s*(\w+)(\??):/gm)].map(
      (match) => `${match[1]}${match[2]}`
    );
    assert.deepEqual(
      fields,
      ["kind", "evidenceIds", "criteria?"],
      "the per-criterion channel is the third field and stays optional"
    );

    const terminal = {
      protocolVersion: 1,
      id: "msg_01234567-89ab-cdef-0123-456789abcdef",
      occurredAt: "2026-08-12T09:00:00.000Z",
      runId: CHILD_RUN_ID,
      taskId: TASK_ID,
      from: "agt_abcdef01-2345-6789-abcd-ef0123456789",
      to: "SUPERVISOR",
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: "did the work",
      artifactIds: [ARTIFACT_ID],
      evidenceIds: [EVIDENCE_ID],
      verification: {
        kind: "PASSED",
        evidenceIds: [EVIDENCE_ID],
        criteria: [{ id: "crit-a", kind: "FAILED", evidenceIds: [EVIDENCE_ID] }]
      }
    };
    assert.deepEqual(
      validateAgentMessage(terminal),
      terminal,
      "the same message R8-4 pinned as additive-but-unread still validates unchanged"
    );

    // And is now read. Absence is what keeps every log written before the
    // field meaning exactly what it meant, so both halves are asserted here.
    const spoken = assessChildObservation({
      observation: observationFromChild(childReportingUnmetCriterion(), specFor("tester", ["crit-a"])),
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    const silent = assessChildObservation({
      observation: observationFromChild(childOutcome("PASSED"), specFor("tester", ["crit-a"])),
      episodeId: "ep_probe",
      runId: "run_probe"
    });
    assert.equal(spoken.apply, true);
    assert.equal(silent.apply, true);
    if (!spoken.apply || !silent.apply) return;
    assert.deepEqual(spoken.assessment.gate.codes, ["unmet-acceptance-criterion"]);
    assert.deepEqual(silent.assessment.gate.codes, []);
  });

  it("the durable per-task criteria seam is declared, validated, and never synthesized", async () => {
    // R9-1 reserved a sibling field on `FlowchartCheckpointState` for option
    // (a) and pinned it unimplemented; that reservation is spent here, so this
    // is its replacement. The unimplemented half of R9-1's assertion has since
    // landed behaviourally in `test/integration/m2.5/resume.test.ts` ("a resume
    // re-dispatches recorded criteria and leaves an unrecorded node unknown",
    // R12-1); this file keeps only the source-side half.
    const source = await readFile(join(REPO_ROOT, "src/run/replay.ts"), "utf8");
    const region = /export interface FlowchartCheckpointState \{[\s\S]*?^\}$/m.exec(source);
    assert.ok(region, "FlowchartCheckpointState remains structurally inspectable");
    assert.match(region[0], /taskCriteria\?: TaskAcceptanceCriteria\[\]/);
    assert.match(region[0], /never \*synthesized\*/, "the never-synthesize rule stays in-source");
    assert.match(region[0], /not from the bound episode/);

    const base = {
      definition: FLOWCHART_DEFINITION,
      snapshot: FLOWCHART_SNAPSHOT,
      limits: FLOWCHART_LIMITS
    };
    // Absence stays valid, and stays absent: an unknown must not round-trip
    // into an empty list, because empty means "dispatched with none".
    assert.equal("taskCriteria" in validateFlowchartCheckpointState(base), false);

    const known = validateFlowchartCheckpointState({
      ...base,
      taskCriteria: [
        { taskId: TASK_ID, acceptanceCriteria: [{ id: "crit-a", description: "the suite passes" }] },
        { taskId: OTHER_TASK_ID, acceptanceCriteria: [] }
      ]
    });
    assert.deepEqual(known.taskCriteria?.map((entry) => entry.acceptanceCriteria.length), [1, 0]);

    for (const [label, taskCriteria] of [
      ["an empty array is a second spelling of unknown", []],
      ["a non-array", {}],
      ["a bad task id", [{ taskId: "not-a-task", acceptanceCriteria: [] }]],
      [
        "descending task ids, which is also how duplicates are refused",
        [
          { taskId: OTHER_TASK_ID, acceptanceCriteria: [] },
          { taskId: TASK_ID, acceptanceCriteria: [] }
        ]
      ],
      [
        "a repeated criterion id within one task",
        [
          {
            taskId: TASK_ID,
            acceptanceCriteria: [
              { id: "crit-a", description: "one" },
              { id: "crit-a", description: "two" }
            ]
          }
        ]
      ],
      ["a blank criterion description", [{ taskId: TASK_ID, acceptanceCriteria: [{ id: "crit-a", description: "  " }] }]]
    ] as const) {
      assert.throws(
        () => validateFlowchartCheckpointState({ ...base, taskCriteria }),
        (error: unknown) =>
          error instanceof DomainValidationError &&
          /Invalid RunCheckpoint: flowchart\.taskCriteria/.test(error.message),
        label
      );
    }
  });
});

interface Behaviour {
  readonly label: string;
  readonly outcome: ObservedChildOutcome;
  readonly kind: "PASSED" | "FAILED";
  readonly summary: string;
}

const OUTCOMES: readonly ObservedChildOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"];

/** The same 30 child behaviours R7-2's sweep uses, so the two are comparable. */
const BEHAVIOURS: readonly Behaviour[] = OUTCOMES.flatMap((outcome) =>
  (["PASSED", "FAILED"] as const).flatMap((kind) =>
    [
      { suffix: "claiming success", summary: "all checks passed and verified" },
      { suffix: "neutral prose", summary: "did the work" },
      { suffix: "silent", summary: "" }
    ].map((prose) => ({
      label: `${outcome}/${kind}/${prose.suffix}`,
      outcome,
      kind,
      summary: prose.summary
    }))
  )
);

const CRITERIA_VARIANTS: readonly (readonly string[])[] = [[], ["crit-a"], ["crit-a", "crit-b"]];

const CONSTRAINT_VARIANTS: readonly (readonly ConstraintRecord[])[] = [0, 1, 2].map((count) =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `con-${index}`,
    text: `constraint ${index}`,
    kind: "constraint" as const,
    mandatory: true as const
  }))
);

function observationOf(
  behaviour: Behaviour,
  requiredChecks: readonly string[],
  constraints: readonly ConstraintRecord[]
): ChildObservation {
  return {
    taskId: "tsk_probe",
    role: "tester",
    outcome: behaviour.outcome,
    summary: behaviour.summary,
    evidenceIds: ["evd_one"],
    artifactIds: ["art_one"],
    verification: { kind: behaviour.kind, evidenceIds: ["evd_one"] },
    requiredChecks,
    constraints
  };
}

async function typeScriptFilesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await typeScriptFilesUnder(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}
