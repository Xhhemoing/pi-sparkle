import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { createEventId, type EventId } from "../../../src/domain/ids.js";
import type { Event } from "../../../src/run/events.js";
import { applyTrackingGate } from "../../../src/run/gate-apply.js";
import { hashAssessment, parseTrackingAssessment } from "../../../src/tracking/types.js";
import { makeEvent } from "../../helpers/event-factory.js";

/**
 * The gate's reconstruction of the run status is a consistency ledger for the
 * transition record, deliberately not a control input on the flowchart plane
 * (Loop 4 R9-6, parent-signed; the posture itself is recorded in
 * `src/run/gate-apply.ts`, which is where a reader should find it).
 *
 * These pins hold both halves down. The record half: the posture is stated in
 * source — matched after whitespace normalization, so rewrapping the comment
 * cannot break the pin — and `runStatus` really is the value the transition
 * carries. The control half: `runStatus` has no reader outside the module that
 * produces it, and the flowchart plane still takes only the events it must
 * append from the gate's answer. Giving `runStatus` a consumer is then a
 * visible act with its own justification, not a silent widening of the gate's
 * authority.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GATE_APPLY = "src/run/gate-apply.ts";
const FLOWCHART_RUN = "src/run/flowchart-run.ts";

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function listSourceModules(relativeDirectory: string): string[] {
  const modules: string[] = [];
  const pending = [relativeDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of readdirSync(resolve(REPO_ROOT, directory), { withFileTypes: true })) {
      const module = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pending.push(module);
      else if (entry.isFile() && entry.name.endsWith(".ts")) modules.push(module);
    }
  }
  return modules.sort();
}

/**
 * Every place a file *reads* a `runStatus` off some value.
 *
 * Declaring the field or writing it is what a producer does, so `runStatus:` in
 * a type member or an object literal is not a reader. Dereferencing it — by
 * property access, by index, or by destructuring — is.
 */
function runStatusReaders(fileName: string, source: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "runStatus") {
      found.push(`${node.expression.getText()}.runStatus`);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "runStatus"
    ) {
      found.push(`${node.expression.getText()}["runStatus"]`);
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && key.text === "runStatus") {
        found.push(`destructured out of ${node.parent.parent.getText().split("\n")[0] ?? ""}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(fileName, source));
  return found;
}

function assertNoRunStatusReader(modules: readonly { file: string; source: string }[]): void {
  const readers = modules
    .filter((module) => module.file !== GATE_APPLY)
    .flatMap((module) =>
      runStatusReaders(module.file, module.source).map((use) => `${module.file}: ${use}`)
    );
  assert.deepEqual(
    readers,
    [],
    "GateApplyResult.runStatus is the gate's ledger entry, not a control input: a consumer needs its own justification"
  );
}

/** The property names a file dereferences off what `applyChildThreeLine` returned. */
function gateResultUses(fileName: string, source: string): string[] {
  const parsed = parse(fileName, source);
  const bindings: string[] = [];
  const used = new Set<string>();
  let calls = 0;

  function collectBindings(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "applyChildThreeLine"
    ) {
      calls += 1;
      const declaration = node.parent;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer === node) {
        if (ts.isIdentifier(declaration.name)) bindings.push(declaration.name.text);
        else if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            const key = element.propertyName ?? element.name;
            if (ts.isIdentifier(key)) used.add(key.text);
          }
        }
      } else {
        // Chained or passed on rather than bound to a name: the use cannot be
        // attributed, so report it instead of letting it through unseen.
        used.add("used without being bound to a name");
      }
    }
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(parsed);

  function collectUses(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      bindings.includes(node.expression.text)
    ) {
      used.add(node.name.text);
    }
    ts.forEachChild(node, collectUses);
  }
  collectUses(parsed);

  assert.equal(calls, 1, `${fileName} should reach the three-line gate exactly once`);
  return [...used].sort();
}

function assertFlowchartDiscardsGateResult(fileName: string, source: string): void {
  assert.deepEqual(
    gateResultUses(fileName, source),
    ["events"],
    "the flowchart plane takes control from its own supervisor and the replayed log, never from the gate result"
  );
}

/** A declaration's leading comment, whitespace-collapsed so rewrapping it is safe. */
function leadingCommentOf(fileName: string, source: string, declaration: string): string {
  const parsed = parse(fileName, source);
  let found: ts.Node | undefined;
  function visit(node: ts.Node): void {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name?.text === declaration
    ) {
      found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found !== undefined, `${fileName} must still declare ${declaration}`);
  return (ts.getLeadingCommentRanges(source, found.getFullStart()) ?? [])
    .map((range) => source.slice(range.pos, range.end))
    .join(" ")
    .replace(/\/\*\*?|\*\//g, " ")
    .replace(/^[ \t]*\*/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertRecordsPosture(source: string, declaration: string, phrases: readonly string[]): void {
  const comment = leadingCommentOf(GATE_APPLY, source, declaration);
  for (const phrase of phrases) {
    assert.ok(
      comment.includes(phrase),
      `${declaration} must keep recording the posture; missing: "${phrase}"`
    );
  }
}

const RESULT_POSTURE = [
  "consistency ledger for the transition record, not a control input",
  "outside this module nothing reads it",
  "discards the result whole",
  "soft and hard both block"
] as const;

const RECONSTRUCTION_POSTURE = [
  "this reconstruction never decides anything",
  "observable only through the `from` field"
] as const;

test("the posture is recorded in source at GateApplyResult and at currentGateStatus", () => {
  const source = readSource(GATE_APPLY);
  assertRecordsPosture(source, "GateApplyResult", RESULT_POSTURE);
  assertRecordsPosture(source, "currentGateStatus", RECONSTRUCTION_POSTURE);
});

test("GateApplyResult.runStatus has no reader outside the module that produces it", () => {
  assertNoRunStatusReader(
    listSourceModules("src").map((file) => ({ file, source: readSource(file) }))
  );
});

test("the flowchart path uses the gate's answer only for the events it appends", () => {
  assertFlowchartDiscardsGateResult(FLOWCHART_RUN, readSource(FLOWCHART_RUN));
});

test("the absence pins reject a reader of runStatus and a flowchart consumer of the result", () => {
  for (const [shape, source] of [
    ["a property read", "const status = gated.result.runStatus;\n"],
    ["a destructure", "const { runStatus } = gated.result;\n"],
    ["an index read", 'const status = gated.result["runStatus"];\n']
  ] as const) {
    assert.throws(
      () => assertNoRunStatusReader([{ file: "src/run/flowchart-run.ts", source }]),
      assert.AssertionError,
      `${shape} of runStatus must cross the pin`
    );
  }
  assert.deepEqual(
    runStatusReaders(
      "synthetic.ts",
      "interface R { readonly runStatus: string }\nconst r: R = { runStatus: 'RUNNING' };\n"
    ),
    [],
    "declaring and writing the field is what a producer does; only dereferencing it is a read"
  );
  assert.throws(
    () =>
      assertFlowchartDiscardsGateResult(
        "flowchart-run.ts",
        "const gated = applyChildThreeLine({});\nif (gated.result.runStatus === 'BLOCKED') halt();\n"
      ),
    assert.AssertionError,
    "letting the gate's status steer the flowchart loop must cross the pin"
  );
  assert.throws(
    () =>
      assertRecordsPosture(
        "export interface GateApplyResult { readonly runStatus: string }\n",
        "GateApplyResult",
        RESULT_POSTURE
      ),
    assert.AssertionError,
    "dropping the record must cross the pin"
  );
});

/**
 * The same mutations against the files as they actually are, so the pins are
 * known to hold *these* sources down and not just a synthetic that resembles
 * them. Nothing is written: each mutation is applied to the string.
 */
test("the pins hold the real sources down, and survive a rewrapped comment", () => {
  const gateApply = readSource(GATE_APPLY);
  assert.throws(
    () =>
      assertRecordsPosture(
        gateApply.replace("consistency ledger", "record"),
        "GateApplyResult",
        RESULT_POSTURE
      ),
    assert.AssertionError,
    "restating the posture in other words must be a deliberate act"
  );
  // Rewrapping is not a restatement: joining every continuation line leaves the
  // pin green, which is what lets a later editor reflow the comment freely.
  assertRecordsPosture(gateApply.replace(/\n\s*\*(?!\/)[ \t]?/g, " "), "GateApplyResult", RESULT_POSTURE);
  assertRecordsPosture(
    gateApply.replace(/\n\s*\*(?!\/)[ \t]?/g, " "),
    "currentGateStatus",
    RECONSTRUCTION_POSTURE
  );

  const flowchart = readSource(FLOWCHART_RUN);
  const binding = /const\s+(\w+)\s*=\s*applyChildThreeLine\(/.exec(flowchart)?.[1];
  assert.ok(binding !== undefined, "the flowchart plane must still bind the gate's answer to a name");
  const consumer = `${flowchart}\nvoid ${binding}.result.runStatus;\n`;
  assert.throws(
    () => assertFlowchartDiscardsGateResult(FLOWCHART_RUN, consumer),
    assert.AssertionError,
    "a real consumer of the gate result on the flowchart plane must cross the pin"
  );
  assert.throws(
    () => assertNoRunStatusReader([{ file: FLOWCHART_RUN, source: consumer }]),
    assert.AssertionError,
    "and must cross the whole-tree reader pin too"
  );
});

function assessment(overrides: Record<string, unknown> = {}) {
  return parseTrackingAssessment({
    schemaVersion: 1,
    episodeId: "ep_a",
    runId: "run_a",
    turnId: "trn_1",
    prescore: 0.8,
    quality: 1,
    coverage: 0.8,
    human: { kind: "unobserved" },
    score: 0.8,
    dimensions: [{ id: "check-coverage", verdict: "PASS", evidenceRefs: ["evd_1"] }],
    gate: { kind: "none", codes: [], wakeAnalysis: false, expandDetail: false, askUser: false, openMinors: [] },
    evidenceRefs: ["evd_1"],
    ...overrides
  });
}

const BLOCKING = assessment({
  score: 0.2,
  prescore: 0.2,
  dimensions: [{ id: "scope-safety", verdict: "FAIL", evidenceRefs: ["evd_1"] }],
  gate: {
    kind: "hard",
    codes: ["ownership-escape"],
    wakeAnalysis: true,
    expandDetail: true,
    askUser: false,
    openMinors: []
  }
});

let minted = 0;
const nextEventId = () => createEventId(() => `p${++minted}`);

function apply(events: readonly Event[], input = BLOCKING, expectedSeq = 0) {
  return applyTrackingGate({
    events,
    assessment: input,
    assessmentHash: hashAssessment(input),
    expectedSeq,
    policyVersion: "track-v1",
    nowIso: "2026-08-24T00:00:00.000Z",
    generateEventId: nextEventId
  });
}

function transitions(events: readonly Event[]) {
  return events
    .filter(
      (event): event is Extract<Event, { type: "GATE_TRANSITION" }> => event.type === "GATE_TRANSITION"
    )
    .map((event) => ({ from: event.payload.from, to: event.payload.to }));
}

function blockedRun(suffix: string): { events: Event[]; blockedEventId: EventId } {
  const blockedEventId = createEventId(() => suffix);
  return {
    events: [
      makeEvent(
        "RUN_BLOCKED",
        { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_1"] },
        { id: blockedEventId }
      )
    ],
    blockedEventId
  };
}

test("runStatus is exactly the ledger entry the transition carries", () => {
  const applied = apply([]);
  const written = applied.events.find(
    (event): event is Extract<Event, { type: "GATE_TRANSITION" }> => event.type === "GATE_TRANSITION"
  );
  assert.ok(written !== undefined, "a hard gate writes a transition");
  assert.equal(applied.result.runStatus, written.payload.to);
  assert.equal(applied.result.transitionId, written.payload.transitionId);
});

test("with no transition to write, runStatus reports what one would have recorded", () => {
  const applied = apply(blockedRun("noneb").events, assessment(), 1);
  assert.equal(applied.result.directive, "none");
  assert.deepEqual(transitions(applied.events), [], "a none-gate writes no transition");
  assert.equal(
    applied.result.runStatus,
    "BLOCKED",
    "the ledger still answers with the `from` a transition would have carried"
  );
});

test("currentGateStatus reads a matched RUN_UNBLOCKED as RUNNING and an unmatched one as BLOCKED", () => {
  const matched = blockedRun("matched");
  assert.deepEqual(
    transitions(
      apply([
        ...matched.events,
        makeEvent("RUN_UNBLOCKED", {
          blockedEventId: matched.blockedEventId,
          reason: "operator authorized a retry"
        })
      ]).events
    ),
    [{ from: "RUNNING", to: "BLOCKED" }],
    "R8-1's contract: the gate and replay agree about which run is running"
  );

  const unmatched = blockedRun("unmatched");
  assert.deepEqual(
    transitions(
      apply([
        ...unmatched.events,
        makeEvent("RUN_UNBLOCKED", {
          blockedEventId: createEventId(() => "someotherblock"),
          reason: "names a block that is not the one in force"
        })
      ]).events
    ),
    [{ from: "BLOCKED", to: "BLOCKED" }],
    "an unblock that does not name the active block clears nothing"
  );
});

test("currentGateStatus gives a matched discard authorization the same ledger status", () => {
  const discardUnblock = (blockedEventId: EventId) =>
    makeEvent("RUN_UNBLOCKED_WITH_DISCARD", {
      blockedEventId,
      reason: "operator authorized discarding completed descendants",
      retryNodeId: "failed",
      rewoundDescendants: [
        {
          nodeId: "completed-child",
          taskId: "tsk_completed_child",
          previousState: "COMPLETED",
          modelRouteEventIds: [],
          childRunIds: [],
          chargedEstimatedCostUsd: 0,
          chargedEstimatedDurationMs: 0
        }
      ]
    });

  const matched = blockedRun("discardmatched");
  assert.deepEqual(
    transitions(apply([...matched.events, discardUnblock(matched.blockedEventId)]).events),
    [{ from: "RUNNING", to: "BLOCKED" }],
    "the stronger authorization clears the active block for the transition ledger only"
  );

  const unmatched = blockedRun("discardunmatched");
  assert.deepEqual(
    transitions(
      apply([
        ...unmatched.events,
        discardUnblock(createEventId(() => "someotherdiscardblock"))
      ]).events
    ),
    [{ from: "BLOCKED", to: "BLOCKED" }],
    "the stronger authorization still cannot clear a block it does not name"
  );
});
