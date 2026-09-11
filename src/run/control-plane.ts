import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";
import { runtimeRoot } from "../privacy/state-layout.js";

export type ControlRequestKind = "pause" | "inject";

export interface PauseControlMessage {
  readonly kind: "pause";
  readonly requestId: string;
  readonly submittedAt: IsoTimestamp;
  readonly reason?: string;
}

export interface InjectControlMessage {
  readonly kind: "inject";
  readonly requestId: string;
  readonly submittedAt: IsoTimestamp;
  readonly request: unknown;
}

export type ControlMessage = PauseControlMessage | InjectControlMessage;

export type ControlAckStatus = "applied" | "rejected";

export interface ControlAck {
  readonly requestId: string;
  readonly status: ControlAckStatus;
  readonly kind: ControlRequestKind;
  readonly acknowledgedAt: IsoTimestamp;
  /** Present when status is rejected. */
  readonly reason?: string;
  /** Replay status after apply, when applied. */
  readonly runStatus?: string;
}

function controlRoot(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "control");
}

function pendingPath(stateRoot: string, runId: RunId, requestId: string): string {
  return join(controlRoot(stateRoot, runId), "pending", `${requestId}.json`);
}

function ackPath(stateRoot: string, runId: RunId, requestId: string): string {
  return join(controlRoot(stateRoot, runId), "ack", `${requestId}.json`);
}

function parseControlMessage(raw: string): ControlMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainValidationError("malformed control message: not valid JSON");
  }
  if (!isRecord(parsed)) throw new DomainValidationError("malformed control message: not an object");
  if (typeof parsed.requestId !== "string" || parsed.requestId.trim() === "") {
    throw new DomainValidationError("malformed control message: requestId must be a non-empty string");
  }
  if (!isIsoTimestamp(parsed.submittedAt)) {
    throw new DomainValidationError("malformed control message: submittedAt must be a valid IsoTimestamp");
  }
  if (parsed.kind === "pause") {
    if (parsed.reason !== undefined && (typeof parsed.reason !== "string" || parsed.reason.trim() === "")) {
      throw new DomainValidationError("malformed control message: pause reason must be a non-empty string");
    }
    return {
      kind: "pause",
      requestId: parsed.requestId,
      submittedAt: parsed.submittedAt,
      ...(parsed.reason !== undefined ? { reason: parsed.reason } : {})
    };
  }
  if (parsed.kind === "inject") {
    return {
      kind: "inject",
      requestId: parsed.requestId,
      submittedAt: parsed.submittedAt,
      request: parsed.request
    };
  }
  throw new DomainValidationError("malformed control message: kind must be pause or inject");
}

function parseControlAck(raw: string): ControlAck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainValidationError("malformed control ack: not valid JSON");
  }
  if (!isRecord(parsed)) throw new DomainValidationError("malformed control ack: not an object");
  if (typeof parsed.requestId !== "string" || parsed.requestId.trim() === "") {
    throw new DomainValidationError("malformed control ack: requestId required");
  }
  if (parsed.status !== "applied" && parsed.status !== "rejected") {
    throw new DomainValidationError("malformed control ack: status must be applied or rejected");
  }
  if (parsed.kind !== "pause" && parsed.kind !== "inject") {
    throw new DomainValidationError("malformed control ack: kind must be pause or inject");
  }
  if (!isIsoTimestamp(parsed.acknowledgedAt)) {
    throw new DomainValidationError("malformed control ack: acknowledgedAt must be a valid IsoTimestamp");
  }
  return {
    requestId: parsed.requestId,
    status: parsed.status,
    kind: parsed.kind,
    acknowledgedAt: parsed.acknowledgedAt,
    ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    ...(typeof parsed.runStatus === "string" ? { runStatus: parsed.runStatus } : {})
  };
}

export interface RunControlPlane {
  submit(message: Omit<PauseControlMessage, "requestId" | "submittedAt"> | Omit<InjectControlMessage, "requestId" | "submittedAt">): Promise<ControlMessage>;
  listPending(): Promise<ControlMessage[]>;
  acknowledge(ack: Omit<ControlAck, "acknowledgedAt">): Promise<ControlAck>;
  waitForAck(requestId: string, options?: { timeoutMs?: number; pollMs?: number }): Promise<ControlAck>;
  readAck(requestId: string): Promise<ControlAck | undefined>;
}

/**
 * File-backed pause/inject control plane. Submitters never persist run lifecycle
 * state: they only enqueue a message with a requestId. The sole writer (the main
 * run loop, or a short-lived drain that holds the lifecycle lock while idle)
 * consumes pending messages, persists, and writes an ack.
 */
export function createFileRunControlPlane(
  stateRoot: string,
  runId: RunId,
  now: () => IsoTimestamp,
  generateId: () => string = randomUUID
): RunControlPlane {
  return {
    async submit(partial) {
      const message = {
        ...partial,
        requestId: generateId(),
        submittedAt: now()
      } as ControlMessage;
      await writeFileAtomic(pendingPath(stateRoot, runId, message.requestId), `${JSON.stringify(message, null, 2)}\n`);
      return message;
    },
    async listPending() {
      const dir = join(controlRoot(stateRoot, runId), "pending");
      const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      });
      const messages: ControlMessage[] = [];
      for (const entry of entries.toSorted()) {
        if (!entry.endsWith(".json")) continue;
        const raw = await readFile(join(dir, entry), "utf8");
        messages.push(parseControlMessage(raw));
      }
      return messages;
    },
    async acknowledge(partial) {
      const ack: ControlAck = { ...partial, acknowledgedAt: now() };
      await mkdir(join(controlRoot(stateRoot, runId), "ack"), { recursive: true });
      await writeFileAtomic(ackPath(stateRoot, runId, ack.requestId), `${JSON.stringify(ack, null, 2)}\n`);
      await unlink(pendingPath(stateRoot, runId, ack.requestId)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      return ack;
    },
    async readAck(requestId) {
      const raw = await readFile(ackPath(stateRoot, runId, requestId), "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        }
      );
      if (raw === undefined) return undefined;
      return parseControlAck(raw);
    },
    async waitForAck(requestId, options = {}) {
      const timeoutMs = options.timeoutMs ?? 30_000;
      const pollMs = options.pollMs ?? 20;
      const startedAt = Date.now();
      for (;;) {
        const ack = await this.readAck(requestId);
        if (ack !== undefined) return ack;
        if (Date.now() - startedAt >= timeoutMs) {
          throw new DomainValidationError(
            `timed out waiting for control ack requestId=${requestId} run=${runId}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  };
}
