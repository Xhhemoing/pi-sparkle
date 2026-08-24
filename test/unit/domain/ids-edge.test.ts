import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  createId,
  createRunId,
  isAgentProfileId,
  isEpisodeId,
  isEventId,
  isMessageId,
  isProjectId,
  isRunId,
  isTaskId,
  parseAgentProfileId,
  parseEpisodeId,
  parseEventId,
  parseMessageId,
  parseProjectId,
  parseRunId,
  parseTaskId
} from "../../../src/domain/ids.js";

const idKinds = [
  { prefix: "prj", guard: isProjectId, parse: parseProjectId },
  { prefix: "run", guard: isRunId, parse: parseRunId },
  { prefix: "tsk", guard: isTaskId, parse: parseTaskId },
  { prefix: "msg", guard: isMessageId, parse: parseMessageId },
  { prefix: "evt", guard: isEventId, parse: parseEventId },
  { prefix: "ep", guard: isEpisodeId, parse: parseEpisodeId },
  { prefix: "prf", guard: isAgentProfileId, parse: parseAgentProfileId }
] as const;

test("all public id parsers fail closed on malformed values", () => {
  for (const { prefix, guard, parse } of idKinds) {
    const invalid = [
      undefined,
      null,
      42,
      "",
      prefix,
      `${prefix}_`,
      `${prefix.toUpperCase()}_valid`,
      `${prefix}_with.dot`,
      `${prefix}_with/slash`,
      `${prefix}_space value`,
      `${prefix}_é`,
      `${prefix}_${"x".repeat(65)}`,
      "other_valid"
    ];

    for (const value of invalid) {
      assert.equal(guard(value), false, `${prefix} guard accepted ${String(value)}`);
      assert.throws(
        () => parse(value),
        DomainValidationError,
        `${prefix} parser accepted ${String(value)}`
      );
    }
  }
});

test("id suffix boundaries and supported punctuation are consistent across brands", () => {
  for (const { prefix, guard, parse } of idKinds) {
    for (const suffix of ["x", "a_B-9", "x".repeat(64)]) {
      const value = `${prefix}_${suffix}`;
      assert.equal(guard(value), true);
      assert.equal(parse(value), value);
    }
  }
});

test("id factories reject invalid generated suffixes and unknown brands", () => {
  for (const suffix of ["", "with.dot", "with/slash", "space value", "é", "x".repeat(65)]) {
    assert.throws(() => createRunId(() => suffix), DomainValidationError);
  }
  assert.throws(() => createId("UnknownId" as never), /Unknown id brand/);
});
