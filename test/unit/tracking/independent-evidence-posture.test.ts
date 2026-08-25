import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import {
  prescoreInputFromObservation,
  type ChildObservation
} from "../../../src/tracking/from-child.js";
import { computePrescore, type PrescoreInput } from "../../../src/tracking/prescore.js";
import type { VerificationKind } from "../../../src/protocol/v1.js";
import type { ConstraintRecord } from "../../../src/tracking/types.js";

/**
 * `PrescoreInput.independentEvidence` is not third-party verification (Loop 4
 * R10-5, parent-signed; the posture itself is recorded in
 * `src/tracking/from-child.ts` at the write and in `src/tracking/prescore.ts`
 * at the discard, which is where a reader should find it).
 *
 * The name promises corroboration and the value cannot supply it: the sole
 * production producer sets it from `verification.kind`, and since Loop 4 R9-2
 * a pi child can author that verdict about itself. What keeps the mismatch
 * harmless today is that nothing reads the flag — `computePrescore` discards
 * it — so the score never treats a claim as a check.
 *
 * These pins hold all three halves of that down. The record: the posture is
 * stated in source, matched after whitespace normalization so rewrapping the
 * comments cannot break the pin. The absence: across all of `src` the field is
 * dereferenced exactly once, and that one dereference is the discard. The
 * fact: the flag really is a restatement of the child's own verdict, and
 * flipping it changes no prescore anywhere in the dimension space. Giving it a
 * reader is then a visible act with its own justification, and whoever does it
 * has to answer the naming question first.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FROM_CHILD = "src/tracking/from-child.ts";
const PRESCORE = "src/tracking/prescore.ts";
const FLOWCHART_RUN = "src/run/flowchart-run.ts";
const FIELD = "independentEvidence";

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
 * Every place a file *reads* an `independentEvidence` off some value, tagged
 * with whether the read is immediately thrown away by `void`.
 *
 * Declaring the field or writing it is what a producer does, so
 * `independentEvidence:` in a type member or an object literal is not a
 * reader. Dereferencing it — by property access, by index, or by
 * destructuring — is.
 */
function independentEvidenceReads(fileName: string, source: string): string[] {
  const found: string[] = [];
  const discarded = (node: ts.Node): string => (ts.isVoidExpression(node.parent) ? "void " : "");
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === FIELD) {
      found.push(`${discarded(node)}${node.expression.getText()}.${FIELD}`);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === FIELD
    ) {
      found.push(`${discarded(node)}${node.expression.getText()}["${FIELD}"]`);
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && key.text === FIELD) {
        found.push(`destructured out of ${node.parent.parent.getText().split("\n")[0] ?? ""}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(fileName, source));
  return found;
}

/** The one dereference the tree is allowed to contain. */
const ONLY_READ = [`${PRESCORE}: void input.${FIELD}`] as const;

function assertOnlyReadIsTheDiscard(modules: readonly { file: string; source: string }[]): void {
  const reads = modules.flatMap((module) =>
    independentEvidenceReads(module.file, module.source).map((use) => `${module.file}: ${use}`)
  );
  assert.deepEqual(
    reads,
    [...ONLY_READ],
    "independentEvidence is set from the child's own verdict, not corroborated by anyone: " +
      "the only dereference in src is the discard in computePrescore"
  );
}

/** Comment text, whitespace-collapsed so rewrapping the comment is safe. */
function collapse(raw: string): string {
  return raw
    .replace(/\/\*\*?|\*\//g, " ")
    .replace(/^[ \t]*\*(?!\/)/gm, " ")
    .replace(/^[ \t]*\/\//gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function leadingCommentOf(source: string, node: ts.Node): string {
  return collapse(
    (ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [])
      .map((range) => source.slice(range.pos, range.end))
      .join("\n")
  );
}

function findOne(fileName: string, source: string, matches: (node: ts.Node) => boolean): ts.Node {
  const found: ts.Node[] = [];
  function visit(node: ts.Node): void {
    if (matches(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parse(fileName, source));
  assert.equal(found.length, 1, `${fileName} must contain exactly one of the pinned sites`);
  const only = found[0];
  assert.ok(only !== undefined);
  return only;
}

/** The comment on the object-literal write in `prescoreInputFromObservation`. */
function writeSiteComment(source: string): string {
  return leadingCommentOf(
    source,
    findOne(
      FROM_CHILD,
      source,
      (node) =>
        ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === FIELD
    )
  );
}

/** The comment on the `void` statement that discards the flag. */
function discardComment(source: string): string {
  return leadingCommentOf(
    source,
    findOne(
      PRESCORE,
      source,
      (node) =>
        ts.isExpressionStatement(node) &&
        ts.isVoidExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === FIELD
    )
  );
}

/** The comment on the field's declaration in `PrescoreInput`. */
function declarationComment(source: string): string {
  return leadingCommentOf(
    source,
    findOne(
      PRESCORE,
      source,
      (node) =>
        ts.isPropertySignature(node) && ts.isIdentifier(node.name) && node.name.text === FIELD
    )
  );
}

function assertRecords(where: string, comment: string, phrases: readonly string[]): void {
  for (const phrase of phrases) {
    assert.ok(
      comment.includes(phrase),
      `${where} must keep recording the posture; missing: "${phrase}"`
    );
  }
}

const WRITE_POSTURE = [
  "Not third-party verification, despite the name",
  "the child's report of what it ran",
  "Nothing reads the flag today"
] as const;

const DISCARD_POSTURE = [
  "not corroboration and may not move the score",
  "a decision with its own justification"
] as const;

const DECLARATION_POSTURE = [
  "that a party other than the actor confirmed it",
  "sets it from the child's own terminal TASK_RESULT"
] as const;

/**
 * Re-flow every run of whole-line `//` comments to a different width, so the
 * prose pins can be shown to survive an editor reflowing them. Nothing is
 * written: the transform is applied to the string.
 */
function rewrapLineComments(source: string, width: number): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const opener = /^([ \t]*)\/\/ ?(.*)$/.exec(line);
    if (opener === null) {
      out.push(line);
      index += 1;
      continue;
    }
    const indent = opener[1] ?? "";
    const words: string[] = [];
    while (index < lines.length) {
      const next = /^([ \t]*)\/\/ ?(.*)$/.exec(lines[index] ?? "");
      if (next === null || next[1] !== indent) break;
      words.push(...(next[2] ?? "").split(/\s+/).filter((word) => word !== ""));
      index += 1;
    }
    let current = "";
    for (const word of words) {
      const grown = current === "" ? word : `${current} ${word}`;
      if (current !== "" && indent.length + 3 + grown.length > width) {
        out.push(`${indent}// ${current}`);
        current = word;
      } else {
        current = grown;
      }
    }
    if (current !== "") out.push(`${indent}// ${current}`);
  }
  return out.join("\n");
}

/** Join every JSDoc continuation line, the same reflow R9-6's pins survive. */
function rewrapBlockComments(source: string): string {
  return source.replace(/\n\s*\*(?!\/)[ \t]?/g, " ");
}

/** Drop the whole comment block sitting immediately above a line of real source. */
function withoutCommentAbove(source: string, marker: string): string {
  const lines = source.split("\n");
  const at = lines.findIndex((line) => line.includes(marker));
  assert.equal(
    lines.filter((line) => line.includes(marker)).length,
    1,
    `the mutant needs exactly one "${marker}"`
  );
  let first = at;
  while (first > 0 && /^[ \t]*(\/\/|\/?\*)/.test(lines[first - 1] ?? "")) first -= 1;
  assert.notEqual(first, at, `"${marker}" must carry a comment for the mutant to remove`);
  return [...lines.slice(0, first), ...lines.slice(at)].join("\n");
}

test("the posture is recorded at the write, at the discard, and on the declaration", () => {
  const fromChild = readSource(FROM_CHILD);
  const prescore = readSource(PRESCORE);
  assertRecords(`${FROM_CHILD} at the write`, writeSiteComment(fromChild), WRITE_POSTURE);
  assertRecords(`${PRESCORE} at the discard`, discardComment(prescore), DISCARD_POSTURE);
  assertRecords(`${PRESCORE} at the declaration`, declarationComment(prescore), DECLARATION_POSTURE);
});

test("across all of src the field is dereferenced exactly once, and that read is the discard", () => {
  assertOnlyReadIsTheDiscard(
    listSourceModules("src").map((file) => ({ file, source: readSource(file) }))
  );
});

test("the flowchart spine is inside the census and cannot touch the field", () => {
  const modules = listSourceModules("src").map((file) => ({ file, source: readSource(file) }));
  const flowchartRun = modules.find((module) => module.file === FLOWCHART_RUN);
  assert.ok(flowchartRun, `${FLOWCHART_RUN} must remain inside the whole-src census`);
  assert.equal(
    flowchartRun.source.includes(FIELD),
    false,
    `${FLOWCHART_RUN} must not mention ${FIELD}`
  );

  assert.throws(
    () =>
      assertOnlyReadIsTheDiscard(
        modules.map((module) =>
          module.file === FLOWCHART_RUN
            ? { ...module, source: `${module.source}\nconst trusted = input.${FIELD};\n` }
            : module
        )
      ),
    assert.AssertionError,
    `a drive-by ${FIELD} reader in ${FLOWCHART_RUN} must cross the pin`
  );
});

test("the pins hold the real sources down, and survive rewrapped comments", () => {
  const fromChild = readSource(FROM_CHILD);
  const prescore = readSource(PRESCORE);

  // Rewrapping is not a restatement: reflowing the real comments at two widths
  // the author did not choose leaves every pin green, which is what lets a
  // later editor reflow them freely.
  for (const width of [58, 96]) {
    assertRecords(
      `${FROM_CHILD} rewrapped at ${width}`,
      writeSiteComment(rewrapLineComments(fromChild, width)),
      WRITE_POSTURE
    );
    assertRecords(
      `${PRESCORE} rewrapped at ${width}`,
      discardComment(rewrapLineComments(prescore, width)),
      DISCARD_POSTURE
    );
  }
  assertRecords(
    `${PRESCORE} with its JSDoc joined`,
    declarationComment(rewrapBlockComments(prescore)),
    DECLARATION_POSTURE
  );

  assert.throws(
    () =>
      assertRecords(
        FROM_CHILD,
        writeSiteComment(fromChild.replace("Not third-party verification", "Not independent")),
        WRITE_POSTURE
      ),
    assert.AssertionError,
    "restating the posture in other words must be a deliberate act"
  );
  for (const [where, read, marker, phrases] of [
    [FROM_CHILD, writeSiteComment, `${FIELD}: verification?.kind`, WRITE_POSTURE],
    [PRESCORE, discardComment, `void input.${FIELD};`, DISCARD_POSTURE],
    [PRESCORE, declarationComment, `readonly ${FIELD}: boolean;`, DECLARATION_POSTURE]
  ] as const) {
    const source = where === FROM_CHILD ? fromChild : prescore;
    assert.throws(
      () => assertRecords(where, read(withoutCommentAbove(source, marker)), phrases),
      assert.AssertionError,
      `deleting the record above "${marker}" must cross the pin`
    );
  }

  // A real consumer, and a discard turned into a control input.
  assert.throws(
    () =>
      assertOnlyReadIsTheDiscard([
        { file: PRESCORE, source: prescore },
        { file: FROM_CHILD, source: `${fromChild}\nconst trusted = observation.independentEvidence;\n` }
      ]),
    assert.AssertionError,
    "reading the flag as corroboration must cross the pin"
  );
  assert.throws(
    () =>
      assertOnlyReadIsTheDiscard([
        {
          file: PRESCORE,
          source: prescore.replace(
            "void input.independentEvidence;",
            "if (input.independentEvidence) qualitySum += 1;"
          )
        }
      ]),
    assert.AssertionError,
    "keeping the dereference but dropping the void must cross the pin too"
  );
  assert.deepEqual(
    independentEvidenceReads(
      "synthetic.ts",
      "interface P { readonly independentEvidence: boolean }\n" +
        "const p: P = { independentEvidence: true };\n"
    ),
    [],
    "declaring and writing the field is what a producer does; only dereferencing it is a read"
  );
});

const KINDS: readonly (VerificationKind | undefined)[] = [
  "PASSED",
  "FAILED",
  "UNOBSERVED",
  undefined
];

const CONSTRAINTS: readonly ConstraintRecord[] = [
  { id: "con-0", text: "constraint 0", kind: "constraint", mandatory: true }
];

function observation(
  kind: VerificationKind | undefined,
  evidenceIds: readonly string[],
  artifactIds: readonly string[]
): ChildObservation {
  return {
    taskId: "tsk_probe",
    role: "tester",
    outcome: "SUCCESS",
    summary: "did the work",
    evidenceIds,
    artifactIds,
    ...(kind !== undefined ? { verification: { kind, evidenceIds } } : {}),
    requiredChecks: ["crit-a"],
    constraints: CONSTRAINTS
  };
}

test("the flag restates the child's own verdict and nothing else", () => {
  // Evidence and artifact ids are the facts that most look like a second
  // party's corroboration. They do not reach the flag: it is a function of
  // `verification.kind` alone — the same self-report the verdict comes from.
  for (const kind of KINDS) {
    const byKind = new Set<boolean>();
    for (const evidenceIds of [[], ["evd_one"], ["evd_one", "evd_two"]]) {
      for (const artifactIds of [[], ["art_one"]]) {
        byKind.add(prescoreInputFromObservation(observation(kind, evidenceIds, artifactIds)).independentEvidence);
      }
    }
    assert.deepEqual(
      [...byKind],
      [kind === "PASSED" || kind === "FAILED"],
      `verification.kind ${String(kind)} must fix the flag on its own`
    );
  }
});

test("flipping the flag moves no prescore, which is why the mismatch is harmless today", () => {
  const lists: readonly (readonly string[])[] = [[], ["a"], ["a", "b"]];
  let cells = 0;
  for (const requiredChecks of lists) {
    for (const completedChecks of lists) {
      for (const constraints of [[], CONSTRAINTS]) {
        for (const retainedConstraintIds of [[], ["con-0"]]) {
          for (const progressed of [true, false] as const) {
            for (const claims of [[], ["all checks passed"]] as const) {
              const base: PrescoreInput = {
                claims,
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
                requiredChecks,
                completedChecks,
                constraints,
                retainedConstraintIds,
                progressed,
                stalledTurns: 0,
                independentEvidence: true
              };
              cells += 1;
              assert.deepEqual(
                computePrescore({ ...base, independentEvidence: false }),
                computePrescore(base),
                "the flag is inert: no dimension, no cap, and no score reads it"
              );
            }
          }
        }
      }
    }
  }
  assert.equal(cells, 3 * 3 * 2 * 2 * 2 * 2);
  assert.equal(cells, 144);
});
