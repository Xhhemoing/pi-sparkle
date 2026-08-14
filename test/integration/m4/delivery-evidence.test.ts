import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDiffAdapter } from "../../../src/evaluation/diff-adapter.js";
import { createDeliveryAdapter } from "../../../src/evaluation/delivery-adapter.js";
import { classifyDiffScope } from "../../../src/evaluation/ownership.js";
import type { AdapterContext } from "../../../src/evaluation/adapters.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

const context: AdapterContext = {
  episodeId: createEpisodeId(),
  workingDirectory: "/work/proj",
  revision: "rev-1",
  changeSet: ["src/feature.ts"],
};

describe("M4-T2: delivery evidence end to end", () => {
  it("final validation ties to the final change set; a pre-change pass cannot close the episode", async () => {
    const diffAdapter = createDiffAdapter();
    const deliveryAdapter = createDeliveryAdapter();

    // Initial validation passes on the episode-owned change set.
    const initial = await diffAdapter.evaluate(
      context,
      classifyDiffScope(context, ["src/feature.ts"])
    );
    assert.equal(initial.outcome, "PASS");

    // After validation the user edits an unrelated file: the final change set
    // no longer matches the validated one, so the episode cannot close on it.
    const afterUserEdit = await diffAdapter.evaluate(
      context,
      classifyDiffScope(context, ["src/feature.ts", "notes.md"])
    );
    assert.equal(afterUserEdit.outcome, "FAIL");
    assert.match(afterUserEdit.reason ?? "", /unrelated user changes/);

    // Even with a stale green diff, delivery remains open until acceptance is observed.
    const unobserved = await deliveryAdapter.evaluate(context, {});
    assert.equal(unobserved.outcome, "UNOBSERVED");

    const accepted = await deliveryAdapter.evaluate(
      context,
      { manualAcceptance: true, userComment: "verified locally" }
    );
    assert.equal(accepted.outcome, "PASS");
  });

  it("a rollback caused by an external dependency fails delivery with explicit attribution", async () => {
    const deliveryAdapter = createDeliveryAdapter();
    const result = await deliveryAdapter.evaluate(context, {
      manualAcceptance: true,
      rollbackDetected: true,
      userComment: "dependency upgrade broke the build",
    });
    assert.equal(result.outcome, "FAIL");
    assert.equal(result.evidenceRef, `rollback:${context.revision}`);
    assert.match(result.reason ?? "", /rollback detected after delivery/);
  });

  it("malformed delivery input abstains instead of masquerading as missing evidence", async () => {
    const deliveryAdapter = createDeliveryAdapter();
    // Wrongly typed fields must be invalid input (ABSTAIN), not "no evidence"
    // (UNOBSERVED) — the OR-connected guard previously accepted these.
    const malformed = await deliveryAdapter.evaluate(context, { manualAcceptance: "yes" });
    assert.equal(malformed.outcome, "ABSTAIN");
    assert.match(malformed.reason ?? "", /invalid input/);
  });

  it("reopening a closed episode is an outcome, not silent closure", async () => {
    const deliveryAdapter = createDeliveryAdapter();
    const result = await deliveryAdapter.evaluate(context, { reopenDetected: true });
    assert.equal(result.outcome, "FAIL");
    assert.equal(result.evidenceRef, `reopen:${context.revision}`);
  });
});
