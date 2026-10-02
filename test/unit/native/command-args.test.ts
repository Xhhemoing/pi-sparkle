import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCandidateCommandArgs, parseCandidateDisposalArgs } from "../../../src/native/command-args.js";

const cases: readonly { name: string; input: string; expected: readonly string[] }[] = [
  { name: "legacy unquoted paths", input: "run_1 art_v2_1 /tmp/candidate /tmp/source /tmp/state",
    expected: ["run_1", "art_v2_1", "/tmp/candidate", "/tmp/source", "/tmp/state"] },
  { name: "Windows paths with spaces", input: String.raw`run_1 art_v2_1 "C:\candidate work" "D:\source repo" "C:\state root"`,
    expected: ["run_1", "art_v2_1", String.raw`C:\candidate work`, String.raw`D:\source repo`, String.raw`C:\state root`] },
  { name: "UNC paths and trailing backslashes", input: String.raw`run_1 art_v2_1 "\\server\candidate work\" "C:\source repo\" "C:\state\"`,
    expected: ["run_1", "art_v2_1", "\\\\server\\candidate work\\", "C:\\source repo\\", "C:\\state\\"] },
  { name: "single quotes", input: "run_1 art_v2_1 '/tmp/candidate work' '/tmp/source repo' '/tmp/state root'",
    expected: ["run_1", "art_v2_1", "/tmp/candidate work", "/tmp/source repo", "/tmp/state root"] },
  { name: "apostrophe inside double quotes", input: `run_1 art_v2_1 "/tmp/O'Brien candidate" /tmp/source /tmp/state`,
    expected: ["run_1", "art_v2_1", "/tmp/O'Brien candidate", "/tmp/source", "/tmp/state"] },
  { name: "literal shell syntax is not expanded", input: 'run_1 art_v2_1 "$HOME/candidate" "$(echo source)" "~/state/*"',
    expected: ["run_1", "art_v2_1", "$HOME/candidate", "$(echo source)", "~/state/*"] },
  { name: "Unicode and whitespace", input: '  run_1\tart_v2_1 "/tmp/候选 变更" /tmp/source /tmp/state  ',
    expected: ["run_1", "art_v2_1", "/tmp/候选 变更", "/tmp/source", "/tmp/state"] }
];
for (const item of cases) {
  test(`candidate command parses ${item.name}`, () => {
    assert.deepEqual(parseCandidateCommandArgs(item.input), item.expected);
  });
}

for (const input of [
  "", "run_1 art_v2_1 /c /s", "run_1 art_v2_1 /c /s /state extra",
  'run_1 art_v2_1 "" /s /state', 'run_1 art_v2_1 "   " /s /state',
  'run_1 art_v2_1 "/c /s /state', "run_1 art_v2_1 '/c /s /state",
  'run_1 art_v2_1 "/c"suffix /s /state', 'run_1 art_v2_1 /c"bad" /s /state',
  "run_1 art_v2_1 /c\n /s /state", "run_1 art_v2_1 /c\r /s /state",
  "run_1 art_v2_1 /c\0 /s /state", "run_1 art_v2_1 /c\u2028 /s /state"
]) {
  test(`candidate command rejects malformed input: ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseCandidateCommandArgs(input));
  });
}

test("disposal parser accepts structured JSON and quoted positional paths", () => {
  const expected = {
    runId: "run_1",
    artifactId: "art_v2_1",
    candidatePath: "C:\\Candidate Work\\'中文'",
    sourceRepo: "C:\\Source Repo\\'中文'",
    stateRoot: "C:\\State Root\\'中文'"
  };
  assert.deepEqual(parseCandidateDisposalArgs(JSON.stringify(expected)), expected);
  assert.deepEqual(
    parseCandidateDisposalArgs(
      [expected.runId, expected.artifactId, expected.candidatePath, expected.sourceRepo, expected.stateRoot]
        .map((value) => `"${value}"`)
        .join(" ")
    ),
    expected
  );
  assert.throws(() => parseCandidateDisposalArgs('{"runId":"run_1","extra":"refused"}'), /unknown fields/i);
});
