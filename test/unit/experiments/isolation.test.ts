import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertWritablePath,
  createIsolationGuard,
} from "../../../src/experiments/isolation.js";

describe("M6-T2: isolation guard", () => {
  const guard = () =>
    createIsolationGuard({
      readOnlyRoots: ["/live/workspace", "/live/event-log", "/live/active-resources"],
      outputRoot: "/replay/out",
    });

  it("allows writes inside the isolated output root", () => {
    assert.doesNotThrow(() => assertWritablePath(guard(), "/replay/out/report.json"));
    assert.doesNotThrow(() => assertWritablePath(guard(), "/replay/out"));
  });

  it("rejects writes into the original workspace, event logs, and active resources", () => {
    for (const path of [
      "/live/workspace/src/main.ts",
      "/live/workspace",
      "/live/event-log/episodes.jsonl",
      "/live/active-resources/pointers.json",
    ]) {
      assert.throws(() => assertWritablePath(guard(), path), /read-only isolation violation/);
    }
  });

  it("rejects writes outside the output root entirely", () => {
    assert.throws(() => assertWritablePath(guard(), "/somewhere/else.txt"), /isolated output root/);
  });

  it("rejects an output root nested inside a read-only root at construction", () => {
    assert.throws(
      () =>
        createIsolationGuard({
          readOnlyRoots: ["/live/workspace"],
          outputRoot: "/live/workspace/replay",
        }),
      /output root .+ overlaps/
    );
  });

  it("rejects a read-only root nested inside the output root at construction", () => {
    assert.throws(
      () =>
        createIsolationGuard({
          readOnlyRoots: ["/replay/out/secret"],
          outputRoot: "/replay/out",
        }),
      /read-only root .+ overlaps/
    );
  });

  it("treats sibling paths sharing a prefix as distinct", () => {
    const siblingGuard = createIsolationGuard({
      readOnlyRoots: ["/live/workspace"],
      outputRoot: "/live/workspace-out",
    });
    assert.doesNotThrow(() => assertWritablePath(siblingGuard, "/live/workspace-out/x.txt"));
    assert.throws(
      () => assertWritablePath(siblingGuard, "/live/workspace/x.txt"),
      /read-only isolation violation/
    );
  });
});
