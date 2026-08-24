import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  buildPiCompatReport,
  type PiCompatReport,
  type PiPinnedVersions
} from "../pi-compat/check.js";
import { CLI_EXIT, cliFail } from "./errors.js";

export interface PiCompatIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const PI_COMPAT_USAGE = `pi-sparkle pi-compat — offline-first Pi compatibility report

Usage:
  pi-sparkle pi-compat [--json] [--offline]
  pi-sparkle pi-compat --online [--json]

Offline is the default: the report is built from the pinned Pi versions in
package.json plus a source probe of src/pi-adapter. --online additionally reads
the npm dist-tags for the pinned packages and fails closed (status unknown,
exit 0) when the registry is unreachable. Exit 1 is reserved for a broken
adapter contract.
`;

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 5_000;
const BROKEN_PREFIX = "BROKEN: ";

export function readSparklePackageJson(): unknown {
  return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as unknown;
}

/** Never throws: an unreadable package.json becomes a BROKEN finding instead. */
export function buildOfflinePiCompatReport(now?: string): PiCompatReport {
  let packageJson: unknown;
  try {
    packageJson = readSparklePackageJson();
  } catch {
    packageJson = undefined;
  }
  return buildPiCompatReport({
    packageJson,
    offline: true,
    ...(now !== undefined ? { now } : {})
  });
}

/**
 * Only a broken adapter contract earns exit 1 (ADR-001 boundary): a legacy
 * Google thinking-level reference, no thinking levels at all, an unreadable
 * pin, or unreadable adapter sources. Being behind latest stays exit 0.
 */
export function piCompatBreakage(report: PiCompatReport): string | undefined {
  const broken = report.findings.find((finding) => finding.startsWith(BROKEN_PREFIX));
  if (broken !== undefined) return broken.slice(BROKEN_PREFIX.length);
  if (report.adapter.googleThinkingType === "legacy-GoogleThinkingLevel") {
    return "adapter references the legacy GoogleThinkingLevel type";
  }
  if (report.adapter.thinkingLevels.length === 0) {
    return "adapter exposes no thinking levels";
  }
  return undefined;
}

/**
 * Registry names are derived from the pins rather than hardcoded, so the Pi
 * scope stays declared in exactly one place (package.json) and ADR-001 keeps
 * package identifiers out of the domain side of the adapter boundary.
 */
function pinnedPiPackageNames(packageJson: unknown): { agentCore: string; ai: string } {
  const dependencies =
    typeof packageJson === "object" && packageJson !== null
      ? (packageJson as { dependencies?: unknown }).dependencies
      : undefined;
  const names =
    typeof dependencies === "object" && dependencies !== null ? Object.keys(dependencies) : [];
  const agentCore = names.find((name) => name.endsWith("/pi-agent-core"));
  const ai = names.find((name) => name.endsWith("/pi-ai"));
  if (agentCore === undefined || ai === undefined) {
    throw new Error("package.json does not pin the Pi agent-core and ai packages");
  }
  return { agentCore, ai };
}

function registryUrl(): string {
  return (process.env.PI_COMPAT_REGISTRY_URL ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, "");
}

async function fetchLatestVersion(packageName: string): Promise<string> {
  const response = await fetch(`${registryUrl()}/${packageName}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`${packageName}: registry responded HTTP ${response.status}`);
  }
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string" || body.version.trim() === "") {
    throw new Error(`${packageName}: registry response has no version`);
  }
  return body.version;
}

/** Fails closed: a registry problem yields no latest versions, never a throw. */
async function fetchLatestPiVersions(packageJson: unknown): Promise<{
  latest?: PiPinnedVersions;
  error?: string;
}> {
  try {
    const names = pinnedPiPackageNames(packageJson);
    const [agentCore, ai] = await Promise.all([
      fetchLatestVersion(names.agentCore),
      fetchLatestVersion(names.ai)
    ]);
    return { latest: { agentCore, ai } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function printReport(io: PiCompatIo, report: PiCompatReport, breakage: string | undefined): void {
  io.stdout("pi-sparkle pi-compat (developer preview — Pi pin vs adapter contract)\n");
  io.stdout(`  generated: ${report.generatedAt}\n`);
  io.stdout(
    `  mode: ${report.offline ? "offline (pass --online to read npm dist-tags)" : "online (npm dist-tags)"}\n`
  );
  io.stdout(`  pinned: agent-core=${report.pinned.agentCore} ai=${report.pinned.ai}\n`);
  io.stdout(
    `  latest: ${
      report.latest !== undefined
        ? `agent-core=${report.latest.agentCore} ai=${report.latest.ai}`
        : report.offline
          ? "skipped (offline)"
          : "unavailable (registry unreachable)"
    }\n`
  );
  io.stdout(
    `  adapter: google-thinking=${report.adapter.googleThinkingType} thinking-levels=${
      report.adapter.thinkingLevels.length === 0 ? "(none)" : report.adapter.thinkingLevels.join(",")
    }\n`
  );
  io.stdout(
    `  adapter: nested-skill-discovery=${report.adapter.nestedSkillDiscovery ? "yes" : "no"} agents-md-not-broken-skill=${
      report.adapter.agentsMdNotBrokenSkill ? "yes" : "no"
    }\n`
  );
  io.stdout(`  status: ${report.status}\n`);
  if (report.findings.length === 0) {
    io.stdout("  findings: (none)\n");
  } else {
    io.stdout("  findings:\n");
    for (const finding of report.findings) {
      io.stdout(`    - ${finding}\n`);
    }
  }
  io.stdout(
    breakage === undefined
      ? "  next: pnpm cli pi-compat --online compares the pins against the npm registry\n"
      : "  next: adapt src/pi-adapter, then pnpm typecheck and record the pin move in the changelog\n"
  );
}

export async function piCompatCommand(args: string[], io: PiCompatIo): Promise<number> {
  const [first] = args;
  if (first === "help" || first === "--help" || first === "-h") {
    io.stdout(PI_COMPAT_USAGE);
    return CLI_EXIT.ok;
  }
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
      online: { type: "boolean", default: false }
    }
  });
  if (values.offline === true && values.online === true) {
    return cliFail(io, {
      command: "pi-compat",
      stage: "parse-args",
      message: "pi-compat accepts either --offline or --online, not both",
      next: "drop one flag; offline is the default"
    });
  }
  const offline = values.online !== true;

  let packageJson: unknown;
  try {
    packageJson = readSparklePackageJson();
  } catch (error) {
    io.stderr(`warning: pi-sparkle package.json is unreadable: ${error instanceof Error ? error.message : String(error)}\n`);
    packageJson = undefined;
  }
  let latest: PiPinnedVersions | undefined;
  if (!offline) {
    const fetched = await fetchLatestPiVersions(packageJson);
    latest = fetched.latest;
    if (fetched.error !== undefined) {
      io.stderr(`warning: latest Pi versions not fetched: ${fetched.error}\n`);
    }
  }
  const report = buildPiCompatReport({
    packageJson,
    offline,
    ...(latest !== undefined ? { latest } : {})
  });
  const breakage = piCompatBreakage(report);

  if (values.json === true) {
    io.stdout(`${JSON.stringify(report)}\n`);
  } else {
    printReport(io, report, breakage);
  }
  if (breakage !== undefined) {
    return cliFail(io, {
      command: "pi-compat",
      stage: "compat",
      message: `Pi adapter contract is broken: ${breakage}`,
      next: "adapt src/pi-adapter, run pnpm typecheck, and record the Pi pin move in the changelog"
    });
  }
  return CLI_EXIT.ok;
}
