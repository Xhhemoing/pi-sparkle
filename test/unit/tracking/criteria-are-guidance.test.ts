import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assessChildObservation,
  prescoreInputFromObservation,
  type ChildObservation,
  type ChildTrackingDecision,
  type ObservedChildOutcome
} from "../../../src/tracking/from-child.js";
import { computePrescore } from "../../../src/tracking/prescore.js";
import { runTrackingTurn } from "../../../src/tracking/turn.js";
import { DEFAULT_TRACKING_CONFIG } from "../../../src/tracking/config.js";
import type { ConstraintRecord } from "../../../src/tracking/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Loop 4 R7-2, parent-signed option (b): acceptance criteria are prompt
 * guidance and the deterministic verifier is the sole gate. These pins hold
 * the recorded contract at the layer that owns it. R6-2's FAIL-unreachable
 * tripwire (`test/unit/run/flowchart-run-abort.test.ts`) holds the same fact
 * one layer up, against a real child spec, and stays where it is.
 */

const OUTCOMES: readonly ObservedChildOutcome[] = [
  "SUCCESS",
  "PARTIAL",
  "FAILURE",
  "CANCELLED",
  "TIMEOUT"
];

/** The child's own reported behaviour: everything the gate is allowed to read. */
interface Behaviour {
  readonly label: string;
  readonly outcome: ObservedChildOutcome;
  readonly kind: "PASSED" | "FAILED";
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly artifactIds: readonly string[];
}

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
      summary: prose.summary,
      evidenceIds: ["evd_one"],
      artifactIds: ["art_one"]
    }))
  )
);

/** The criteria channel: what the caller asked for, never what the child did. */
const CRITERIA_VARIANTS: readonly (readonly string[])[] = [[], ["crit-a"], ["crit-a", "crit-b"]];

function constraintsOf(count: number): ConstraintRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `con-${index}`,
    text: `constraint ${index}`,
    kind: "constraint" as const,
    mandatory: true
  }));
}

const CONSTRAINT_VARIANTS: readonly (readonly ConstraintRecord[])[] = [
  constraintsOf(0),
  constraintsOf(1),
  constraintsOf(2)
];

function observation(
  behaviour: Behaviour,
  requiredChecks: readonly string[],
  constraints: readonly ConstraintRecord[]
): ChildObservation {
  return {
    taskId: "tsk_probe",
    role: "tester",
    outcome: behaviour.outcome,
    summary: behaviour.summary,
    evidenceIds: behaviour.evidenceIds,
    artifactIds: behaviour.artifactIds,
    verification: { kind: behaviour.kind, evidenceIds: behaviour.evidenceIds },
    requiredChecks,
    constraints
  };
}

function assess(
  behaviour: Behaviour,
  requiredChecks: readonly string[],
  constraints: readonly ConstraintRecord[]
): ChildTrackingDecision {
  return assessChildObservation({
    observation: observation(behaviour, requiredChecks, constraints),
    episodeId: "ep_probe",
    runId: "run_probe"
  });
}

/**
 * Everything `gate-apply.ts::mapGateDirective` reads to choose between
 * `none`, `queue_analysis` and `wait_user`, plus the reason code it stamps on
 * the transition. If this shape is invariant, the directive is.
 */
function directiveInputs(decision: ChildTrackingDecision): Record<string, unknown> {
  if (!decision.apply) return { apply: false };
  const gate = decision.assessment.gate;
  return {
    apply: true,
    kind: gate.kind,
    askUser: gate.askUser,
    wakeAnalysis: gate.wakeAnalysis,
    reasonCode: gate.codes[0] ?? "NONE",
    userRejectStop: gate.codes.includes("user-reject-stop")
  };
}

function verdicts(decision: ChildTrackingDecision): Record<string, string> {
  if (!decision.apply) return {};
  return Object.fromEntries(
    decision.assessment.dimensions.map((dimension) => [dimension.id, dimension.verdict])
  );
}

describe("acceptance criteria are prompt guidance, not a gate", () => {
  it("the directive does not move when criteria and constraints do", () => {
    let cells = 0;
    for (const behaviour of BEHAVIOURS) {
      const baseline = directiveInputs(assess(behaviour, [], constraintsOf(0)));
      for (const requiredChecks of CRITERIA_VARIANTS) {
        for (const constraints of CONSTRAINT_VARIANTS) {
          cells += 1;
          assert.deepEqual(
            directiveInputs(assess(behaviour, requiredChecks, constraints)),
            baseline,
            `${behaviour.label} with ${requiredChecks.length} criteria and ` +
              `${constraints.length} constraints reached a different gate`
          );
        }
      }
    }
    assert.equal(cells, BEHAVIOURS.length * CRITERIA_VARIANTS.length * CONSTRAINT_VARIANTS.length);
    assert.equal(cells, 270);
  });

  it("the two verdicts the deterministic verifier alone produces", () => {
    // Not "the directive is constant" — it is a pure function of one fact.
    const passed = BEHAVIOURS.filter((behaviour) => behaviour.kind === "PASSED");
    const failed = BEHAVIOURS.filter((behaviour) => behaviour.kind === "FAILED");
    for (const behaviour of passed) {
      const decision = assess(behaviour, ["crit-a"], constraintsOf(1));
      assert.equal(decision.apply, true, behaviour.label);
      if (!decision.apply) return;
      assert.equal(decision.assessment.gate.kind, "none", behaviour.label);
      assert.equal(decision.assessment.gate.wakeAnalysis, false, behaviour.label);
    }
    for (const behaviour of failed) {
      const decision = assess(behaviour, ["crit-a"], constraintsOf(1));
      assert.equal(decision.apply, true, behaviour.label);
      if (!decision.apply) return;
      assert.equal(decision.assessment.gate.kind, "hard", behaviour.label);
      assert.equal(decision.assessment.gate.codes[0], "deterministic-fail", behaviour.label);
    }
  });

  it("criteria do change what is recorded, so the sweep is not vacuous", () => {
    const behaviour = BEHAVIOURS.find((item) => item.label === "SUCCESS/PASSED/claiming success");
    assert.ok(behaviour);
    const without = assess(behaviour, [], constraintsOf(0));
    const with2 = assess(behaviour, ["crit-a"], constraintsOf(1));
    assert.equal(without.apply, true);
    assert.equal(with2.apply, true);
    if (!without.apply || !with2.apply) return;

    assert.equal(verdicts(without)["check-coverage"], "NOT_APPLICABLE");
    assert.equal(verdicts(with2)["check-coverage"], "PASS");
    assert.equal(verdicts(without)["constraint-retention"], "NOT_APPLICABLE");
    assert.equal(verdicts(with2)["constraint-retention"], "PASS");
    assert.notEqual(with2.prescore.coverage, 0);
  });

  it("criteria can add an anomaly code, but never the leading one", () => {
    // The one place criteria do reach the gate object: `turn.ts` derives
    // claimed-verification-without-checks from the same copy-fed lists. On
    // FAILED it lands behind deterministic-fail, so it changes neither the
    // directive nor the reason code; on PASSED the copy closes the gap.
    const failing = BEHAVIOURS.find((item) => item.label === "FAILURE/FAILED/claiming success");
    const passing = BEHAVIOURS.find((item) => item.label === "SUCCESS/PASSED/claiming success");
    assert.ok(failing);
    assert.ok(passing);

    const withCriteria = assess(failing, ["crit-a"], constraintsOf(0));
    const without = assess(failing, [], constraintsOf(0));
    assert.equal(withCriteria.apply, true);
    assert.equal(without.apply, true);
    if (!withCriteria.apply || !without.apply) return;
    assert.deepEqual(withCriteria.assessment.gate.codes, [
      "deterministic-fail",
      "claimed-verification-without-checks"
    ]);
    assert.deepEqual(without.assessment.gate.codes, ["deterministic-fail"]);

    const passed = assess(passing, ["crit-a"], constraintsOf(0));
    assert.equal(passed.apply, true);
    if (!passed.apply) return;
    assert.deepEqual(passed.assessment.gate.codes, []);
  });
});

describe("the criteria-shaped dimensions, at their source", () => {
  it("check-coverage has no FAIL in its range, for any input at all", () => {
    const lists: readonly (readonly string[])[] = [[], ["a"], ["b"], ["a", "b"], ["a", "c"]];
    const reachable = new Set<string>();
    for (const requiredChecks of lists) {
      for (const completedChecks of lists) {
        const dimension = computePrescore({
          claims: ["did it"],
          toolSituations: [],
          writePaths: [],
          ownedPaths: [],
          requiredChecks,
          completedChecks,
          constraints: [],
          retainedConstraintIds: [],
          progressed: true,
          stalledTurns: 0,
          independentEvidence: true
        }).dimensions.find((entry) => entry.id === "check-coverage");
        assert.ok(dimension);
        reachable.add(dimension.outcome);
      }
    }
    assert.equal(reachable.has("FAIL"), false, "an unmet required check reads UNOBSERVED, never FAIL");
    assert.deepEqual([...reachable].toSorted(), ["NOT_APPLICABLE", "PASS", "UNOBSERVED"]);
  });

  it("constraint-retention can FAIL, but no observation can make it", () => {
    // Unlike check-coverage this dimension has FAIL in its range; what keeps
    // it out of reach is the producer, so pin both halves.
    const constraints = constraintsOf(1);
    const handBuilt = computePrescore({
      claims: ["did it"],
      toolSituations: [],
      writePaths: [],
      ownedPaths: [],
      requiredChecks: [],
      completedChecks: [],
      constraints,
      retainedConstraintIds: [],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    }).dimensions.find((entry) => entry.id === "constraint-retention");
    assert.equal(handBuilt?.outcome, "FAIL");

    const reachable = new Set<string>();
    for (const behaviour of BEHAVIOURS) {
      for (const variant of CONSTRAINT_VARIANTS) {
        const input = prescoreInputFromObservation(observation(behaviour, ["crit-a"], variant));
        assert.deepEqual(
          input.retainedConstraintIds,
          variant.map((constraint) => constraint.id),
          "retainedConstraintIds is a copy of the constraints' own ids"
        );
        const dimension = computePrescore(input).dimensions.find(
          (entry) => entry.id === "constraint-retention"
        );
        assert.ok(dimension);
        reachable.add(dimension.outcome);
      }
    }
    assert.equal(reachable.has("FAIL"), false);
    assert.deepEqual([...reachable].toSorted(), ["NOT_APPLICABLE", "PASS"]);
  });
});

describe("what it would take for a criterion to gate a child", () => {
  it("a criteria-shaped FAIL caps the displayed prescore and leaves the gate open", () => {
    // The reason option (b) is a decision and not a one-line omission: even
    // with FAIL in range, nothing carries it to the directive. `gates.ts` has
    // no anomaly code for an unmet criterion, and the hard-fail cap reaches
    // `displayPrescore`, not the `P` the gate scores.
    const failing = {
      claims: ["did the work"],
      toolSituations: [
        {
          name: "task-result",
          exitCode: 0,
          wrote: true,
          escaped: false,
          artifactIds: ["art_one"],
          evidenceIds: ["evd_one"],
          hashes: []
        }
      ],
      writePaths: [],
      ownedPaths: [],
      requiredChecks: ["crit-a"],
      completedChecks: ["crit-a"],
      constraints: constraintsOf(1),
      retainedConstraintIds: [],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    };

    const prescore = computePrescore(failing);
    assert.equal(
      prescore.dimensions.find((entry) => entry.id === "constraint-retention")?.outcome,
      "FAIL"
    );
    assert.equal(prescore.cappedByHardFail, true);
    assert.equal(prescore.displayPrescore, DEFAULT_TRACKING_CONFIG.hardFailCap);
    assert.equal(prescore.P, 0.8, "the gate's P loses one dimension's weight, and no more");
    assert.ok(prescore.P > DEFAULT_TRACKING_CONFIG.softThreshold);

    const open = runTrackingTurn({
      window: {
        contextFacts: [],
        toolSituations: failing.toolSituations,
        constraints: failing.constraints,
        unresolvedDecisions: [],
        confirmedDecisions: [],
        openMinors: []
      },
      prescoreInput: failing,
      humanInput: {},
      gateFacts: { deterministicFail: false }
    });
    assert.equal(open.gate.kind, "none");
    assert.deepEqual(open.gate.codes, []);
    assert.equal(open.gate.wakeAnalysis, false);

    const shut = runTrackingTurn({
      window: {
        contextFacts: [],
        toolSituations: failing.toolSituations,
        constraints: failing.constraints,
        unresolvedDecisions: [],
        confirmedDecisions: [],
        openMinors: []
      },
      prescoreInput: failing,
      humanInput: {},
      gateFacts: { deterministicFail: true }
    });
    assert.equal(shut.gate.kind, "hard", "only the verifier shuts the gate");
    assert.deepEqual(shut.gate.codes, ["deterministic-fail"]);
  });
});

describe("the recorded contract", () => {
  it("is written where the dimensions are, and names the verifier as the gate", async () => {
    const prescore = await readFile(join(REPO_ROOT, "src/tracking/prescore.ts"), "utf8");
    const fromChild = await readFile(join(REPO_ROOT, "src/tracking/from-child.ts"), "utf8");
    const prose = (source: string): string =>
      source.replace(/^\s*\*/gm, "").replace(/\s+/g, " ");

    assert.match(
      prose(prescore),
      /acceptance criteria are prompt guidance, and the deterministic verifier is the sole gate/,
      "prescore.ts must keep recording why check-coverage cannot fail"
    );
    assert.match(prose(fromChild), /sole production producer of a `PrescoreInput`/);
    assert.match(prose(fromChild), /derived from the request, not observed/);
  });

  it("points at a tripwire that exists", async () => {
    const prescore = await readFile(join(REPO_ROOT, "src/tracking/prescore.ts"), "utf8");
    assert.match(prescore, /flowchart-run-abort\.test\.ts/);
    const tripwire = await readFile(
      join(REPO_ROOT, "test/unit/run/flowchart-run-abort.test.ts"),
      "utf8"
    );
    assert.match(
      tripwire,
      /check-coverage cannot fail/,
      "R6-2's FAIL-unreachable tripwire is the enforcement half of this contract"
    );
  });

  it("holds on every production path, because there is one", async () => {
    // "The gate never sees a criterion" is only true while assessChildObservation
    // is the sole way into three-line scoring. Adding a second entry point means
    // re-deriving the sweep above for it, not deleting this pin.
    const files = await typeScriptFilesUnder(join(REPO_ROOT, "src"));
    const behaviourModules = ["prescore.js", "turn.js", "gates.js", "from-child.js", "index.js"];
    const importers = new Map<string, string[]>();
    for (const file of files) {
      const relative = file.slice(REPO_ROOT.length);
      if (relative.startsWith("src/tracking/")) continue;
      const source = await readFile(file, "utf8");
      for (const module of behaviourModules) {
        if (source.includes(`tracking/${module}"`)) {
          importers.set(module, [...(importers.get(module) ?? []), relative]);
        }
      }
    }
    assert.deepEqual(
      Object.fromEntries([...importers].toSorted()),
      { "from-child.js": ["src/run/child-tracking.ts"] },
      "assessChildObservation is the only production entry into three-line scoring"
    );
  });
});

async function typeScriptFilesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await typeScriptFilesUnder(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}
