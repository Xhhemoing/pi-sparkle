import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { AGENT_ROLES, type AgentRole } from "../../../src/domain/roles.js";
import type { ArtifactId, EvidenceId, RunId, TaskId } from "../../../src/domain/ids.js";
import { VERIFICATION_KINDS, validateAgentMessage } from "../../../src/protocol/v1.js";
import type { ChildRunOutcome, ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { observationFromChild } from "../../../src/run/child-tracking.js";
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
 * Loop 4 R8-4 — the preconditions option (a) has to satisfy, pinned as they
 * stand under option (b).
 *
 * R7-2 recorded the decision (acceptance criteria are prompt guidance; the
 * deterministic verifier is the sole gate) and `criteria-are-guidance.test.ts`
 * pins it. These pins are the *other* half: the facts a criteria-can-gate
 * design has to move, each locked where it lives today so that moving it is
 * deliberate. Nothing here changes behaviour, and none of it asserts that the
 * present shape is right — only that it is what is shipped.
 *
 * Anyone implementing option (a) replaces these pins in the same diff, with
 * disclosure, and re-derives the 270-cell sweep in
 * `criteria-are-guidance.test.ts` under the new semantics.
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

describe("what a criteria-gating design has to move (option (a) preconditions)", () => {
  it("criteria reach the prescore for exactly one role", () => {
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
  });

  it("no shipped executor can produce the verdict the gate admits on", async () => {
    // The fact that admits a child to three-line scoring is a PASSED or FAILED
    // `verification.kind`, and the only real executor cannot report one:
    // `translatePiEvent` turns pi's stream into TEXT_DELTA/TOOL_*/TURN_FINISHED
    // and never a MESSAGE, so `PiAgentExecutor` always closes the transcript
    // with the terminal it synthesizes itself — UNOBSERVED. A per-criterion
    // channel added to the protocol would land in the same place: no shipped
    // producer could fill it. Re-derive this census when a producer ships; do
    // not delete it.
    const files = await typeScriptFilesUnder(join(REPO_ROOT, "src"));
    const producers = new Map<string, string[]>();
    let piMessages = 0;
    for (const file of files) {
      const relative = file.slice(REPO_ROOT.length);
      // Comments discuss these shapes (`flowchart-run.ts` explains why a
      // FAILED verdict blocks a run); only code produces one.
      const code = (await readFile(file, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const match of code.matchAll(/verification:\s*\{\s*kind:\s*"(PASSED|FAILED|UNOBSERVED)"/g)) {
        producers.set(relative, [...(producers.get(relative) ?? []), match[1] as string]);
      }
      if (relative === "src/pi-adapter/pi-executor.ts") {
        piMessages = [...code.matchAll(/type:\s*"MESSAGE"/g)].length;
      }
    }
    assert.deepEqual(
      Object.fromEntries([...producers].toSorted()),
      {
        "src/cli/main.ts": ["PASSED"],
        "src/pi-adapter/pi-executor.ts": ["UNOBSERVED"],
        "src/testing/fake-executor.ts": ["PASSED"]
      },
      "a scorable verdict has two fake producers and no live one"
    );
    assert.equal(
      piMessages,
      1,
      "the pi adapter emits exactly one protocol message: the terminal it synthesizes"
    );

    // The behavioural half, on the exact shape that adapter synthesizes.
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

  it("the recorded assessment vocabulary has no criterion-shaped anomaly code", () => {
    // A deliberate tripwire, in R7-3's replace-not-weaken shape. `gates.ts`
    // has no code for an unmet acceptance criterion, and the persisted
    // assessment parser refuses one, so a gate path for option (a) cannot be
    // added quietly: whoever adds the code updates this pin in the same diff.
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

    for (const candidate of ["unmet-acceptance-criterion", "criteria-unmet", "acceptance-criterion-fail"]) {
      record.gate.codes = [candidate];
      assert.throws(
        () => parseTrackingAssessment(record),
        (error: unknown) => error instanceof DomainValidationError && /gate\.codes\[0\] is invalid/.test(error.message),
        `${candidate} is not in the recorded vocabulary`
      );
    }
  });

  it("the protocol carries one verdict per task and no per-criterion channel", async () => {
    // The first of option (a)'s three changes is a schema decision, and this
    // is its starting state: three verdict kinds, one verdict object, two
    // fields on it. The tolerance half matters for the design — protocol v1
    // does not reject unknown keys, so a per-criterion field can be added
    // optionally without a version bump, and an absent one must keep meaning
    // exactly what it means today.
    assert.deepEqual([...VERIFICATION_KINDS], ["PASSED", "FAILED", "UNOBSERVED"]);

    const source = await readFile(join(REPO_ROOT, "src/protocol/v1.ts"), "utf8");
    const region = /export interface VerificationResult \{([\s\S]*?)\n\}/.exec(source);
    assert.ok(region, "VerificationResult must stay a declared interface");
    const fields = [...(region[1] ?? "").matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]);
    assert.deepEqual(fields, ["kind", "evidenceIds"], "a per-criterion channel would be a third field");

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
      "unknown keys pass validation unchanged, so the channel would be additive — and unread"
    );
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
