import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { ObservationStore, observationsDir } from "../../../src/context/observation-store.js";
import {
  EVIDENCE_RECEIPT_MARKER,
  OBSERVATION_ELIGIBILITY_MIN_BYTES,
  OBSERVATION_PLACEHOLDER_MAX_BYTES,
  projectObservation,
  type ObservationInput
} from "../../../src/context/observation-projection.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

async function withStore(
  run: (store: ObservationStore, stateRoot: string) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-obs-proj-"));
  const runId = createRunId(UUID);
  const store = new ObservationStore(stateRoot, runId);
  try {
    await run(store, stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function bigText(bytes: number, seed = "payload"): string {
  const unit = `${seed}-${"z".repeat(64)}\n`;
  let out = "";
  while (Buffer.byteLength(out, "utf8") < bytes) out += unit;
  return Buffer.from(out, "utf8").subarray(0, bytes).toString("utf8");
}

function baseInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    id: "toolcall-1",
    toolName: "bash",
    text: bigText(OBSERVATION_ELIGIBILITY_MIN_BYTES + 100),
    isError: false,
    pureText: true,
    evidenceReceipt: false,
    ...overrides
  };
}

test("enabled=false is identity: no archive writes and reason disabled", async () => {
  await withStore(async (store, stateRoot) => {
    const input = baseInput();
    const result = await projectObservation(input, {
      enabled: false,
      priorFullSends: 5,
      store
    });
    assert.equal(result.reason, "disabled");
    assert.equal(result.packed, false);
    assert.equal(result.text, input.text);
    assert.equal(result.ref, undefined);
    await assert.rejects(
      () => readFile(join(observationsDir(stateRoot, store.runId), "objects")),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT" || err.code === "ENOTDIR"
    );
  });
});

test("below threshold is ineligible and does not archive", async () => {
  await withStore(async (store) => {
    const input = baseInput({ text: "tiny" });
    const result = await projectObservation(input, {
      enabled: true,
      priorFullSends: 0,
      store
    });
    assert.equal(result.reason, "ineligible");
    assert.equal(result.packed, false);
    assert.equal(result.text, input.text);
    assert.equal(result.ref, undefined);
  });
});

test("errors, non-pureText, and evidence receipts are ineligible", async () => {
  await withStore(async (store) => {
    for (const overrides of [
      { isError: true },
      { pureText: false },
      { evidenceReceipt: true },
      { text: `${bigText(OBSERVATION_ELIGIBILITY_MIN_BYTES + 50)}\n${EVIDENCE_RECEIPT_MARKER}\n` }
    ] as const) {
      const input = baseInput(overrides as Partial<ObservationInput>);
      const result = await projectObservation(input, {
        enabled: true,
        priorFullSends: 9,
        store
      });
      assert.equal(result.reason, "ineligible", JSON.stringify(overrides));
      assert.equal(result.packed, false);
      assert.equal(result.text, input.text);
    }
  });
});

test("priorFullSends 0 and 1 keep full text, archive for recall, reason first-two", async () => {
  await withStore(async (store) => {
    for (const prior of [0, 1]) {
      const input = baseInput({ id: `call-${prior}` });
      const result = await projectObservation(input, {
        enabled: true,
        priorFullSends: prior,
        store
      });
      assert.equal(result.reason, "first-two");
      assert.equal(result.packed, false);
      assert.equal(result.text, input.text);
      assert.ok(result.ref);
      const page = await store.recall(result.ref, 0);
      assert.equal(page.text, input.text);
      assert.equal(page.eof, true);
    }
  });
});

test("priorFullSends >=2 packs to a placeholder <=2048 bytes with id/hash/excerpts", async () => {
  await withStore(async (store) => {
    const input = baseInput({ id: "call-pack" });
    const result = await projectObservation(input, {
      enabled: true,
      priorFullSends: 2,
      store
    });
    assert.equal(result.reason, "packed");
    assert.equal(result.packed, true);
    assert.ok(result.ref);
    assert.notEqual(result.text, input.text);
    assert.ok(Buffer.byteLength(result.text, "utf8") <= OBSERVATION_PLACEHOLDER_MAX_BYTES);
    assert.match(result.text, new RegExp(result.ref.id));
    assert.match(result.text, new RegExp(result.ref.sha256));
    assert.match(result.text, /byteLength/i);
    assert.match(result.text, /lines/i);
    assert.doesNotMatch(result.text, /hidden.?cot|chain.of.thought/i);
    const page = await store.recall(result.ref, 0);
    assert.ok(page.text.length > 0);
  });
});

test("storage failure fails closed: leaves full text with storage-unavailable", async () => {
  await withStore(async (store) => {
    const input = baseInput();
    const broken = {
      put: async () => {
        throw new Error("disk full");
      },
      recall: store.recall.bind(store),
      runId: store.runId,
      stateRoot: store.stateRoot
    } as unknown as ObservationStore;
    const result = await projectObservation(input, {
      enabled: true,
      priorFullSends: 3,
      store: broken
    });
    assert.equal(result.reason, "storage-unavailable");
    assert.equal(result.packed, false);
    assert.equal(result.text, input.text);
    assert.equal(result.ref, undefined);
  });
});

test("mixed eligibility: small then large then receipt skip", async () => {
  await withStore(async (store) => {
    const small = await projectObservation(baseInput({ text: "nope" }), {
      enabled: true,
      priorFullSends: 0,
      store
    });
    assert.equal(small.reason, "ineligible");

    const first = await projectObservation(baseInput({ id: "a" }), {
      enabled: true,
      priorFullSends: 0,
      store
    });
    assert.equal(first.reason, "first-two");

    const receipt = await projectObservation(
      baseInput({
        id: "r",
        text: `${bigText(12000)}\nmarker ${EVIDENCE_RECEIPT_MARKER} end\n`
      }),
      { enabled: true, priorFullSends: 5, store }
    );
    assert.equal(receipt.reason, "ineligible");
  });
});
