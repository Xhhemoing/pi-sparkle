import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canAutoPromote,
  createDefaultApprovalProfile,
  createInstalledAutoAdaptProfile,
  validateApprovalProfile
} from "../../../src/adaptation/approval-profile.js";
import type { ApprovalProfile } from "../../../src/adaptation/approval-profile.js";
import { NON_AUTO_PROMOTABLE_KINDS } from "../../../src/adaptation/resource.js";
import type { ResourceKind } from "../../../src/adaptation/resource.js";

function lowRiskProfile(overrides: Partial<ApprovalProfile> = {}): ApprovalProfile {
  return {
    profileId: "apr_low-risk",
    profileVersion: 2,
    defaultMode: "proposal-first",
    autoPromoteClasses: ["prompt", "example"],
    neverAutoPromote: [...NON_AUTO_PROMOTABLE_KINDS],
    budget: { maxAutoPromotions: 3 },
    ...overrides
  };
}

describe("M6-T5: approval profiles", () => {
  it("default profile is proposal-first and never auto-promotes", () => {
    const profile = createDefaultApprovalProfile();
    validateApprovalProfile(profile);
    assert.equal(profile.defaultMode, "proposal-first");
    assert.deepEqual(profile.autoPromoteClasses, []);
    assert.deepEqual(profile.neverAutoPromote, [...NON_AUTO_PROMOTABLE_KINDS]);
    assert.equal(profile.budget.maxAutoPromotions, 0);
    assert.equal(canAutoPromote(profile, "prompt", 0), false);
    assert.equal(canAutoPromote(profile, "skill", 0), false);
  });

  it("installed plugin profile does not auto-promote routing-policy", () => {
    const profile = createInstalledAutoAdaptProfile();
    validateApprovalProfile(profile);
    assert.deepEqual(profile.autoPromoteClasses, []);
    assert.equal(canAutoPromote(profile, "routing-policy", 0), false);
    assert.equal(canAutoPromote(profile, "permission", 0), false);
  });

  it("rejects security/permission/credential in autoPromoteClasses", () => {
    for (const kind of NON_AUTO_PROMOTABLE_KINDS) {
      assert.throws(
        () => validateApprovalProfile(lowRiskProfile({ autoPromoteClasses: [kind] })),
        /never auto-promote/
      );
    }
  });

  it("never auto-promotes security/permission/credential even if listed", () => {
    for (const kind of NON_AUTO_PROMOTABLE_KINDS) {
      const sneaky = {
        ...lowRiskProfile(),
        autoPromoteClasses: [kind]
      } as ApprovalProfile;
      assert.equal(canAutoPromote(sneaky, kind, 0), false, `${kind} must never auto-promote`);
    }
  });

  it("requires neverAutoPromote to include permission, security, and credential", () => {
    assert.throws(
      () => validateApprovalProfile(lowRiskProfile({ neverAutoPromote: ["permission"] })),
      /neverAutoPromote must include/
    );
  });

  it("only user-approved low-risk classes may auto-promote inside budget", () => {
    const profile = lowRiskProfile({ budget: { maxAutoPromotions: 1 } });
    validateApprovalProfile(profile);
    assert.equal(canAutoPromote(profile, "prompt", 0), true);
    assert.equal(canAutoPromote(profile, "example", 0), true);
    assert.equal(canAutoPromote(profile, "skill", 0), false);
    assert.equal(canAutoPromote(profile, "prompt", 1), false, "budget exhausted");
  });

  it("profiles are versioned", () => {
    const v1 = lowRiskProfile({
      profileVersion: 1,
      autoPromoteClasses: ["prompt"],
      budget: { maxAutoPromotions: 1 }
    });
    const v2 = lowRiskProfile({
      profileVersion: 2,
      autoPromoteClasses: ["prompt", "example"],
      budget: { maxAutoPromotions: 2 }
    });
    validateApprovalProfile(v1);
    validateApprovalProfile(v2);
    assert.equal(v1.profileId, v2.profileId);
    assert.notEqual(v1.profileVersion, v2.profileVersion);
    assert.equal(canAutoPromote(v1, "example", 0), false);
    assert.equal(canAutoPromote(v2, "example", 0), true);
  });

  it("fails closed on malformed profile ids, versions, and budgets", () => {
    assert.throws(
      () => validateApprovalProfile(lowRiskProfile({ profileId: "nope" })),
      /profile id/
    );
    assert.throws(
      () => validateApprovalProfile(lowRiskProfile({ profileVersion: 0 })),
      /positive integer/
    );
    assert.throws(
      () =>
        validateApprovalProfile(
          lowRiskProfile({ budget: { maxAutoPromotions: -1 } })
        ),
      /budget/
    );
    assert.throws(
      () =>
        validateApprovalProfile(
          lowRiskProfile({
            autoPromoteClasses: ["not-a-kind" as ResourceKind]
          })
        ),
      /invalid autoPromote class/
    );
  });
});
