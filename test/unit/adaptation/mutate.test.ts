import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { hashCandidateContent } from "../../../src/adaptation/candidate.js";
import {
  HIGH_RISK_TASK_FAMILIES,
  LOW_RISK_TASK_FAMILIES,
  mutateOnce,
} from "../../../src/adaptation/mutate.js";
import type { MutationSpec } from "../../../src/adaptation/mutate.js";
import { createResourceVersionId } from "../../../src/domain/ids.js";
import type { ResourceVersionId } from "../../../src/domain/ids.js";

const PARENT = createResourceVersionId(() => "parent01");

function spec(overrides: Partial<MutationSpec> = {}): MutationSpec {
  return {
    what: "prompt",
    when: "offline-inter-test-time",
    where: "typed-parameters",
    parentContent: "You are a careful coding assistant.",
    parentVersionId: PARENT,
    instruction: "Prefer the smallest diff that restores the failing check.",
    ...overrides,
  };
}

describe("M6-T4: mutateOnce", () => {
  it("changes exactly one declared resource boundary and preserves lineage", () => {
    const parentContent = "You are a careful coding assistant.";
    const result = mutateOnce(spec({ parentContent }));
    assert.equal(result.kind, "prompt");
    assert.equal(result.mutation, "append-instruction");
    assert.equal(result.parentVersionId, PARENT);
    assert.ok(result.content.startsWith(parentContent), "parent text stays as a prefix");
    assert.ok(result.content.includes("smallest diff"));
    assert.notEqual(result.content, parentContent);
    assert.equal(result.contentHash, hashCandidateContent(result.content));
    assert.equal("activeVersion" in result, false);
    assert.equal(mutateOnce.length, 1, "no required pointer-setter argument");
  });

  it("rejects permission, security, and credential targets", () => {
    for (const kind of ["permission", "security", "credential"] as const) {
      assert.throws(
        () => mutateOnce(spec({ what: kind as unknown as MutationSpec["what"] })),
        (error: unknown) => {
          assert.ok(error instanceof DomainValidationError);
          assert.match(error.message, /permission|security|credential|cannot mutate/);
          return true;
        }
      );
    }
  });

  it("rejects non-offline when", () => {
    assert.throws(
      () => mutateOnce(spec({ when: "intra-run" as unknown as MutationSpec["when"] })),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /offline-inter-test-time|intra-run/);
        return true;
      }
    );
  });

  it("rejects weights / in-place parameterization", () => {
    assert.throws(
      () => mutateOnce(spec({ where: "weights" as unknown as MutationSpec["where"] })),
      DomainValidationError
    );
  });

  it("rejects topology mutation without topologySearchAllowed", () => {
    assert.throws(
      () => mutateOnce(spec({ what: "workflow-template", instruction: "Add a test-then-edit step." })),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /topologySearchAllowed/);
        return true;
      }
    );
  });

  it("rejects topology mutation for high-risk families", () => {
    for (const taskFamily of HIGH_RISK_TASK_FAMILIES) {
      assert.throws(
        () =>
          mutateOnce(spec({ what: "workflow-template", instruction: "Add a gated deploy step." }), {
            topologySearchAllowed: true,
            taskFamily,
          }),
        (error: unknown) => {
          assert.ok(error instanceof DomainValidationError);
          assert.match(error.message, /high-risk|forbidden/);
          return true;
        }
      );
    }
  });

  it("allows topology mutation for low-risk families when flagged", () => {
    for (const taskFamily of LOW_RISK_TASK_FAMILIES) {
      const result = mutateOnce(
        spec({
          what: "workflow-template",
          parentContent: "steps:\n  - edit\n  - test",
          instruction: "Insert a bounded review step after tests.",
        }),
        { topologySearchAllowed: true, taskFamily }
      );
      assert.equal(result.kind, "workflow-template");
      assert.equal(result.parentVersionId, PARENT);
      assert.ok(result.content.includes("bounded review step"));
    }
  });

  it("replace-section mutates one heading and leaves the rest", () => {
    const parentContent = "## Role\nBe careful.\n## Style\nBe verbose.\n## Guardrails\nNo secrets.";
    const result = mutateOnce(
      spec({
        parentContent,
        instruction: "## Style\nBe terse.",
      }),
      { mutation: "replace-section" }
    );
    assert.equal(result.mutation, "replace-section");
    assert.ok(result.content.includes("## Role\nBe careful."));
    assert.ok(result.content.includes("## Style\nBe terse."));
    assert.ok(!result.content.includes("Be verbose."));
    assert.ok(result.content.includes("## Guardrails\nNo secrets."));
  });

  it("adjust-parameter changes exactly one typed parameter", () => {
    const parentContent = "parameters:\n  maxRetries: 2\n  timeoutMs: 1000\n";
    const result = mutateOnce(spec({ parentContent, instruction: "maxRetries=4" }), {
      mutation: "adjust-parameter",
    });
    assert.equal(result.mutation, "adjust-parameter");
    assert.match(result.content, /maxRetries: 4/);
    assert.match(result.content, /timeoutMs: 1000/);
  });

  it("rejects an invalid parent version id", () => {
    assert.throws(
      () => mutateOnce(spec({ parentVersionId: "not-a-version" as ResourceVersionId })),
      DomainValidationError
    );
  });
});
