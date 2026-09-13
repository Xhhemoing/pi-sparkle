/* eslint-disable @typescript-eslint/no-explicit-any --
 * Pi tool schemas are generic; this file is inside the adapter/execution boundary. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { DomainValidationError } from "../domain/errors.js";
import { resolveInsideRoot } from "../execution/paths.js";
import { authorizeCommand, type CommandPolicy } from "../execution/command-policy.js";

export interface WorktreeCodingToolsContext {
  /** Absolute isolated worktree root; all paths are bound here. */
  readonly worktreeRoot: string;
  /** Optional max bytes for a single read (default 1 MiB). */
  readonly maxReadBytes?: number;
  /**
   * Host command authorization. Required for `sparkle_run_command` (default
   * deny). Not an OS sandbox — see command-policy docs.
   */
  readonly commandPolicy?: CommandPolicy;
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * Real CLI tools scoped to an isolated worktree. Permissions are enforced in
 * tool code (path escape refused; commandPolicy default-deny), not only in
 * prompts. Pass the returned array into `PiAgentExecutor` /
 * `createConfiguredPiExecutor` via `tools`.
 *
 * Migration: callers that used unrestricted `sparkle_run_command` must pass
 * an explicit `commandPolicy.allow` list.
 */
export function createWorktreeCodingTools(ctx: WorktreeCodingToolsContext): AgentTool<any>[] {
  const root = ctx.worktreeRoot;
  const maxReadBytes = ctx.maxReadBytes ?? 1024 * 1024;

  return [
    {
      name: "sparkle_read_file",
      label: "Sparkle Read File",
      description:
        "Read a UTF-8 file inside the isolated worktree. Paths are resolved against the worktree root; escape and out-of-root symlinks are refused.",
      parameters: Type.Object({
        path: Type.String()
      }),
      execute: async (_toolCallId: string, params: unknown) => {
        const record = params as { path?: unknown };
        if (typeof record.path !== "string" || record.path.trim() === "") {
          throw new DomainValidationError("path must be a non-empty string");
        }
        const abs = resolveInsideRoot(root, record.path);
        const buf = await readFile(abs);
        if (buf.byteLength > maxReadBytes) {
          throw new DomainValidationError(
            `file exceeds maxReadBytes (${buf.byteLength} > ${maxReadBytes}): ${record.path}`
          );
        }
        return textResult(buf.toString("utf8"));
      }
    },
    {
      name: "sparkle_write_file",
      label: "Sparkle Write File",
      description:
        "Controlled write of UTF-8 contents to a path inside the isolated worktree. Escape and out-of-root symlinks are refused. Creates parent directories as needed.",
      parameters: Type.Object({
        path: Type.String(),
        contents: Type.String()
      }),
      execute: async (_toolCallId: string, params: unknown) => {
        const record = params as { path?: unknown; contents?: unknown };
        if (typeof record.path !== "string" || record.path.trim() === "") {
          throw new DomainValidationError("path must be a non-empty string");
        }
        if (typeof record.contents !== "string") {
          throw new DomainValidationError("contents must be a string");
        }
        const abs = resolveInsideRoot(root, record.path);
        await mkdir(dirname(abs), { recursive: true });
        // Re-check after mkdir in case a parent link appeared (best-effort TOCTOU).
        resolveInsideRoot(root, record.path);
        await writeFile(abs, record.contents, "utf8");
        return textResult(`wrote ${record.path} (${Buffer.byteLength(record.contents, "utf8")} bytes)`);
      }
    },
    {
      name: "sparkle_run_command",
      label: "Sparkle Run Command",
      description:
        "Run a host-authorized command with cwd bound to the isolated worktree (no shell). Default deny without commandPolicy. Not a general sandbox.",
      parameters: Type.Object({
        command: Type.String(),
        args: Type.Optional(Type.Array(Type.String()))
      }),
      execute: async (_toolCallId: string, params: unknown) => {
        const record = params as { command?: unknown; args?: unknown };
        if (typeof record.command !== "string" || record.command.trim() === "") {
          throw new DomainValidationError("command must be a non-empty string");
        }
        const args = Array.isArray(record.args)
          ? record.args.map((a) => {
              if (typeof a !== "string") {
                throw new DomainValidationError("args entries must be strings");
              }
              return a;
            })
          : [];
        const authorized = authorizeCommand(ctx.commandPolicy, record.command, args);
        const result = spawnSync(authorized.executable, [...authorized.args], {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: authorized.timeoutMs,
          env: authorized.env,
          maxBuffer: Math.max(authorized.maxStdoutBytes, authorized.maxStderrBytes)
        });
        if (result.error !== undefined && result.status === null) {
          throw new DomainValidationError(`command failed to start: ${result.error.message}`);
        }
        const exitCode = result.status ?? 1;
        const stdout = result.stdout ?? "";
        const stderr = result.stderr ?? "";
        if (Buffer.byteLength(stdout, "utf8") > authorized.maxStdoutBytes) {
          throw new DomainValidationError("sparkle_run_command denied: stdout exceeds host maxStdoutBytes");
        }
        if (Buffer.byteLength(stderr, "utf8") > authorized.maxStderrBytes) {
          throw new DomainValidationError("sparkle_run_command denied: stderr exceeds host maxStderrBytes");
        }
        return textResult(
          JSON.stringify({
            exitCode,
            stdout,
            stderr,
            cwd: root
          })
        );
      }
    }
  ];
}
