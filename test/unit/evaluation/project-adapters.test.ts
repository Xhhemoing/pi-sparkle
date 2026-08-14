import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCheckAdapter,
} from "../../../src/evaluation/check-adapter.js";
import { createDiffAdapter } from "../../../src/evaluation/diff-adapter.js";
import { createDeliveryAdapter } from "../../../src/evaluation/delivery-adapter.js";
import { classifyDiffScope } from "../../../src/evaluation/ownership.js";
import type { AdapterContext, CommandResult, DiffScope } from "../../../src/evaluation/adapters.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

const context: AdapterContext = {
  episodeId: createEpisodeId(),
  workingDirectory: "/work/proj",
  revision: "rev-1",
  changeSet: ["src/feature.ts"],
};

function commandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 100,
    command: "pnpm test",
    cwd: "/work/proj",
    ...overrides,
  };
}

function diffScope(overrides: Partial<DiffScope> = {}): DiffScope {
  return {
    episodeOwned: ["src/feature.ts"],
    unrelatedUser: [],
    generated: [],
    unknown: [],
    ...overrides,
  };
}

describe("M4-T2: project/code/delivery evaluator adapters", () => {
  describe("CheckAdapter", () => {
    it("passes when the command exits 0 in the episode working directory", async () => {
      const adapter = createCheckAdapter();
      const result = await adapter.evaluate(context, commandResult());
      assert.equal(result.outcome, "PASS");
      assert.equal(result.evidenceRef, "exit:0");
      const metadata = result.metadata as Record<string, unknown> | undefined;
      assert.equal(typeof metadata?.artifactHash, "string");
    });

    it("fails a non-zero exit with stderr attribution", async () => {
      const adapter = createCheckAdapter();
      const result = await adapter.evaluate(
        context,
        commandResult({ exitCode: 2, stderr: "typecheck failed" })
      );
      assert.equal(result.outcome, "FAIL");
      assert.equal(result.evidenceRef, "exit:2");
      assert.match(result.reason ?? "", /typecheck failed/);
    });

    it("fails when the command ran in a different working directory (stale run)", async () => {
      const adapter = createCheckAdapter();
      const result = await adapter.evaluate(context, commandResult({ cwd: "/elsewhere" }));
      assert.equal(result.outcome, "FAIL");
      assert.match(result.reason ?? "", /working directory/);
    });

    it("fails when the result revision is stale relative to the episode", async () => {
      const adapter = createCheckAdapter();
      const result = await adapter.evaluate(
        context,
        commandResult({ revision: "rev-0" })
      );
      assert.equal(result.outcome, "FAIL");
      assert.match(result.reason ?? "", /stale result for revision rev-0/);
    });

    it("abstains on inputs that are not CommandResults", async () => {
      const adapter = createCheckAdapter();
      const result = await adapter.evaluate(context, null);
      assert.equal(result.outcome, "ABSTAIN");
    });

    it("declares supported criteria, trust class, timeout, and evidence owner", () => {
      const declaration = createCheckAdapter().declaration;
      assert.deepEqual(declaration.supportedCriteria, ["typecheck", "lint", "build", "test"]);
      assert.equal(declaration.trustClass, "deterministic");
      assert.equal(declaration.unavailableSemantics, "UNOBSERVED");
      assert.equal(declaration.evidenceOwner, "system");
      assert.ok(declaration.timeoutMs > 0);
      assert.equal(declaration.inputContract, "CommandResult");
    });
  });

  describe("DiffAdapter", () => {
    it("passes when every changed file is episode-owned", async () => {
      const result = await createDiffAdapter().evaluate(context, diffScope());
      assert.equal(result.outcome, "PASS");
    });

    it("fails when unrelated user changes are present", async () => {
      const result = await createDiffAdapter().evaluate(
        context,
        diffScope({ unrelatedUser: ["notes.md"] })
      );
      assert.equal(result.outcome, "FAIL");
      assert.match(result.reason ?? "", /unrelated user changes/);
    });

    it("fails when ownership is unknown", async () => {
      const result = await createDiffAdapter().evaluate(
        context,
        diffScope({ unknown: ["vendor/x.c"] })
      );
      assert.equal(result.outcome, "FAIL");
      assert.match(result.reason ?? "", /unknown ownership/);
    });

    it("is UNOBSERVED when the episode produced no owned changes", async () => {
      const result = await createDiffAdapter().evaluate(context, diffScope({ episodeOwned: [] }));
      assert.equal(result.outcome, "UNOBSERVED");
    });

    it("abstains on inputs that are not DiffScopes", async () => {
      const result = await createDiffAdapter().evaluate(context, { foo: 1 });
      assert.equal(result.outcome, "ABSTAIN");
    });
  });

  describe("DeliveryAdapter", () => {
    it("passes on observed manual acceptance", async () => {
      const result = await createDeliveryAdapter().evaluate(
        context,
        { manualAcceptance: true, userComment: "looks good" }
      );
      assert.equal(result.outcome, "PASS");
    });

    it("fails on manual rejection", async () => {
      const result = await createDeliveryAdapter().evaluate(
        context,
        { manualAcceptance: false, userComment: "wrong direction" }
      );
      assert.equal(result.outcome, "FAIL");
      assert.match(result.reason ?? "", /wrong direction/);
    });

    it("fails when a rollback is detected after delivery", async () => {
      const result = await createDeliveryAdapter().evaluate(
        context,
        { manualAcceptance: true, rollbackDetected: true }
      );
      assert.equal(result.outcome, "FAIL");
      assert.match(result.reason ?? "", /rollback detected/);
    });

    it("fails when the episode is reopened after closure", async () => {
      const result = await createDeliveryAdapter().evaluate(
        context,
        { reopenDetected: true }
      );
      assert.equal(result.outcome, "FAIL");
    });

    it("remains UNOBSERVED when no manual acceptance was recorded", async () => {
      const result = await createDeliveryAdapter().evaluate(context, {});
      assert.equal(result.outcome, "UNOBSERVED");
    });

    it("remains UNOBSERVED when delivery evidence is not configured at all", async () => {
      const result = await createDeliveryAdapter().evaluate(context, null);
      assert.equal(result.outcome, "UNOBSERVED");
      assert.match(result.reason ?? "", /not configured|no delivery evidence/);
    });

    it("declares user-owned observed trust semantics", () => {
      const declaration = createDeliveryAdapter().declaration;
      assert.equal(declaration.trustClass, "observed");
      assert.equal(declaration.evidenceOwner, "user");
      assert.deepEqual(declaration.supportedCriteria, ["manual-acceptance", "delivery", "rollback"]);
    });
  });

  describe("classifyDiffScope", () => {
    it("splits changed paths by ownership rules", () => {
      const scope = classifyDiffScope(context, [
        "src/feature.ts",
        "notes.md",
        "dist/bundle.js",
        "node_modules/x/index.js",
        "src/plan.generated.md",
      ]);
      assert.deepEqual(scope.episodeOwned, ["src/feature.ts"]);
      assert.deepEqual(scope.unrelatedUser, ["notes.md"]);
      assert.deepEqual(scope.generated, ["dist/bundle.js", "src/plan.generated.md"]);
      assert.deepEqual(scope.unknown, ["node_modules/x/index.js"]);
    });

    it("treats files outside the episode change set as unrelated user edits", () => {
      const scope = classifyDiffScope(context, ["README.md"]);
      assert.deepEqual(scope.unrelatedUser, ["README.md"]);
      assert.equal(scope.episodeOwned.length, 0);
    });
  });
});
