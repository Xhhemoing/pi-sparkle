import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import { CLI_EXIT, cliFail } from "./errors.js";
import { emptyTaskVerdict, projectApplyRecord, projectTaskVerdict, renderTaskVerdictMarkdown, safeVerdictPath, type TaskVerdictProjection } from "./task-verdict-projection.js";

const MAX_BYTES = 2 * 1024 * 1024;
const USAGE = `Usage: pi-sparkle task verdict --artifact <existing.json> [--apply-record <existing.json>] --json|--markdown

Read one historical Native loop artifact or TaskSpec preflight file without following its references.
An optional host-saved apply result or prepared target must match its candidate and source revision.
Records are editable historical claims; this command does not verify the current source or grant authority.
Raw checker output and private checker details are omitted. Monetary cost remains unknown.
Exit 0 means a supported record was read, including a historical refusal or an incomplete acceptance.
`;
interface Io { stdout(text: string): void; stderr(text: string): void; }
class ReadFailure extends Error {
  constructor(readonly state: "missing" | "corrupt" | "unsafe" | "unavailable", readonly issue: string) { super(issue); }
}
function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
/** No locks, directory creation, path following from records or unbounded allocation. */
async function readEvidence(file: string): Promise<{ value: unknown; byteLength: number }> {
  try {
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new ReadFailure("unsafe", "regular-file-required");
    if (before.size > BigInt(MAX_BYTES)) throw new ReadFailure("corrupt", "evidence-too-large");
    let parent: string;
    try { parent = physicalDirectoryWithoutLinks(path.dirname(file)); }
    catch { throw new ReadFailure("unsafe", "linked-or-unavailable-parent"); }
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const opened = await handle.stat({ bigint: true });
      if (!same(before, opened)) throw new ReadFailure("unsafe", "evidence-changed");
      const bytes = Buffer.alloc(Number(opened.size) + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat({ bigint: true }), named = await lstat(file, { bigint: true });
      if (length !== Number(opened.size) || !same(opened, after) || !same(opened, named) ||
        parent !== physicalDirectoryWithoutLinks(path.dirname(file))) throw new ReadFailure("unsafe", "evidence-changed");
      try { return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))), byteLength: length }; }
      catch { throw new ReadFailure("corrupt", "invalid-json-or-utf8"); }
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof ReadFailure) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new ReadFailure("missing", "evidence-missing");
    if (code === "ELOOP") throw new ReadFailure("unsafe", "linked-input");
    throw new ReadFailure("unavailable", "evidence-unreadable");
  }
}
function readFailure(file: string, error: unknown): TaskVerdictProjection {
  return emptyTaskVerdict(file, error instanceof ReadFailure ? error.state : "unavailable",
    error instanceof ReadFailure ? error.issue : "evidence-unreadable");
}
export async function taskVerdictCommand(args: readonly string[], io: Io): Promise<number> {
  if ((args.length === 1 && args[0] === "--help") || (args.length === 2 && args[0] === "verdict" && args[1] === "--help")) {
    io.stdout(USAGE); return CLI_EXIT.ok;
  }
  let artifact: string | undefined, apply: string | undefined, format: "json" | "markdown" | undefined;
  try {
    if (args[0] !== "verdict") throw new Error("Expected task verdict.");
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--json" || arg === "--markdown") {
        if (format !== undefined) throw new Error("Choose exactly one output format.");
        format = arg === "--json" ? "json" : "markdown";
      } else if (arg === "--artifact" || arg === "--apply-record") {
        const value = args[++i];
        if (value === undefined || value.startsWith("--") || !safeVerdictPath(path.resolve(value))) throw new Error("An ordinary file path is required.");
        if (arg === "--artifact") { if (artifact !== undefined) throw new Error("Duplicate artifact option."); artifact = path.resolve(value); }
        else { if (apply !== undefined) throw new Error("Duplicate apply record option."); apply = path.resolve(value); }
      } else throw new Error("Unsupported task verdict argument.");
    }
    if (artifact === undefined || format === undefined) throw new Error("An artifact and exactly one output format are required.");
  } catch (error) {
    return cliFail(io, { command: "task verdict", stage: "parse-args", message: (error as Error).message, next: "run pi-sparkle task verdict --help" });
  }
  let report: TaskVerdictProjection;
  try { const record = await readEvidence(artifact); report = projectTaskVerdict(artifact, record.value, record.byteLength); }
  catch (error) { report = readFailure(artifact, error); }
  if (apply !== undefined) {
    try { projectApplyRecord(report, apply, (await readEvidence(apply)).value); }
    catch (error) {
      const failure = readFailure(apply, error);
      report.apply.evidenceFile = apply;
      report.apply.evidenceState = failure.evidence.state;
      report.apply.issues.push(...failure.evidence.issues);
    }
  }
  io.stdout(format === "json" ? JSON.stringify(report) + "\n" : renderTaskVerdictMarkdown(report));
  return (report.evidence.state === "available" || report.evidence.state === "incomplete") &&
    (report.apply.evidenceState === "unobserved" || report.apply.evidenceState === "available") ? CLI_EXIT.ok : CLI_EXIT.error;
}
