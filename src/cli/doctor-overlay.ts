import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PI_DISPATCH_CONTRACT } from "../agents/dispatch-preflight.js";

export interface OverlayCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const UNKNOWN_AGENT = /^Unknown agent:\s*([A-Za-z0-9_-]+)/;

export function skillRouteEnabled(
  projectRoot: string,
  envValue: string | undefined
): "off" | "on" | "killed" {
  const flag = (envValue ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return "killed";
  if (flag === "1" || flag === "true" || flag === "yes") return "on";
  return existsSync(join(projectRoot, ".pi", "logs", "skill-route-log.enabled")) ? "on" : "off";
}

function countSkillRouteLines(path: string): { lines: number; truncated: boolean } {
  const raw = readFileSync(path, "utf8");
  if (raw === "") return { lines: 0, truncated: false };
  const segments = raw.split("\n");
  let lines = 0;
  let truncated = false;
  for (let index = 0; index < segments.length; index += 1) {
    const line = segments[index];
    if (line === undefined || line === "") continue;
    try {
      JSON.parse(line);
      lines += 1;
    } catch {
      if (index === segments.length - 1) {
        truncated = true;
        continue;
      }
      throw new Error(`corrupt skill-routes.jsonl at line ${index + 1}`);
    }
  }
  return { lines, truncated };
}

export function skillRouteLogCheck(
  projectRoot: string | undefined,
  envValue: string | undefined = process.env.PI_SKILL_ROUTE_LOG
): OverlayCheck {
  if (projectRoot === undefined) {
    return { name: "skill-route", ok: true, detail: "omitted (pass --project)" };
  }
  const state = skillRouteEnabled(projectRoot, envValue);
  if (state === "killed") {
    return { name: "skill-route", ok: true, detail: "killed (PI_SKILL_ROUTE_LOG=0)" };
  }
  if (state === "off") {
    return {
      name: "skill-route",
      ok: true,
      detail: "disabled (PI_SKILL_ROUTE_LOG=1 or .pi/logs/skill-route-log.enabled)"
    };
  }
  const logPath = join(projectRoot, ".pi", "logs", "skill-routes.jsonl");
  if (!existsSync(logPath)) {
    return { name: "skill-route", ok: true, detail: "enabled, lines=0" };
  }
  try {
    const counted = countSkillRouteLines(logPath);
    const tail = counted.truncated ? "; truncated tail ignored" : "";
    return { name: "skill-route", ok: true, detail: `enabled, lines=${counted.lines}${tail}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "skill-route", ok: false, detail: message };
  }
}

export function unknownAgentDriftCheck(projectRoot: string | undefined): OverlayCheck {
  if (projectRoot === undefined) {
    return { name: "agent-drift", ok: true, detail: "omitted (pass --project)" };
  }
  const runsDir = join(projectRoot, ".pi", "subagents", "runs");
  if (!existsSync(runsDir)) {
    return { name: "agent-drift", ok: true, detail: "no local subagent runs" };
  }
  const counts = new Map<string, number>();
  for (const file of readdirSync(runsDir)) {
    if (!file.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(runsDir, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) continue;
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== "string") continue;
    const match = error.match(UNKNOWN_AGENT);
    const name = match?.[1];
    if (name === undefined) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return { name: "agent-drift", ok: true, detail: "no Unknown agent in local subagent runs" };
  }
  const declared = new Set(DEFAULT_PI_DISPATCH_CONTRACT.piProfiles);
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => {
      const extra = declared.has(name) ? "" : "; undeclared in dispatch contract";
      return `${name} x${n}${extra}`;
    });
  return {
    name: "agent-drift",
    ok: true,
    detail: `historical ${parts.join("; ")} — do not add a profile to silence this`
  };
}
