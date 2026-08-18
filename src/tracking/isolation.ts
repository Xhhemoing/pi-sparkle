import type { ContextPacket } from "../context/packet.js";
import type { RollingSummary } from "./types.js";

/**
 * Execution continues to receive only its task context packet.
 * A rolling summary is tracking-only and is never authority for the actor.
 */
export function bindExecutionContext(packet: ContextPacket, _summary?: RollingSummary): ContextPacket {
  return packet;
}

export function executionMayNotReadSummary(packet: object, summary: RollingSummary): boolean {
  return packet !== summary && !("prescore" in packet) && !("openMinors" in packet);
}
