import { existsSync, readFileSync } from "node:fs";

export interface PiPinnedVersions {
  readonly agentCore: string;
  readonly ai: string;
}

export interface PiCompatAdapterProbe {
  readonly thinkingLevels: readonly string[];
  readonly googleThinkingType:
    | "GoogleApiThinkingLevel"
    | "legacy-GoogleThinkingLevel"
    | "absent";
  readonly nestedSkillDiscovery: boolean;
  readonly agentsMdNotBrokenSkill: boolean;
}

export interface PiCompatReport {
  readonly generatedAt: string;
  readonly offline: boolean;
  readonly pinned: PiPinnedVersions;
  readonly latest?: PiPinnedVersions;
  readonly adapter: PiCompatAdapterProbe;
  readonly status: "current" | "behind" | "ahead" | "unknown";
  readonly findings: readonly string[];
}

type ComparableStatus = "current" | "behind" | "ahead";

interface AdapterInspection {
  readonly probe: PiCompatAdapterProbe;
  readonly assumedNestedSkillDiscovery: boolean;
}

/**
 * The levels supported by the pi-sparkle adapter boundary. This local string
 * contract deliberately avoids importing Pi types across ADR-001.
 */
const SPARKLE_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const UNKNOWN_PINNED_VERSIONS: PiPinnedVersions = {
  agentCore: "unknown",
  ai: "unknown"
};

export function readPinnedPiVersions(packageJson: unknown): PiPinnedVersions {
  if (!isRecord(packageJson)) {
    throw new Error("Cannot read pinned Pi versions: package.json must be an object");
  }

  const dependencies = packageJson["dependencies"];
  if (!isRecord(dependencies)) {
    throw new Error("Cannot read pinned Pi versions: package.json dependencies are missing");
  }

  return {
    agentCore: readDependencyVersion(dependencies, "@earendil-works/pi-agent-core"),
    ai: readDependencyVersion(dependencies, "@earendil-works/pi-ai")
  };
}

export function comparePiVersions(pinned: string, latest: string): ComparableStatus {
  const pinnedParts = parseVersion(pinned);
  const latestParts = parseVersion(latest);

  for (let index = 0; index < pinnedParts.length; index += 1) {
    const pinnedPart = pinnedParts[index];
    const latestPart = latestParts[index];
    if (pinnedPart === undefined || latestPart === undefined) {
      throw new Error("Internal error while comparing Pi versions");
    }
    if (pinnedPart < latestPart) return "behind";
    if (pinnedPart > latestPart) return "ahead";
  }
  return "current";
}

export function probeAdapterContract(input?: {
  readonly readAdapterSource?: () => string;
}): PiCompatAdapterProbe {
  const source = (input?.readAdapterSource ?? readDefaultAdapterSource)();
  return inspectAdapterSource(source).probe;
}

export function buildPiCompatReport(input: {
  readonly packageJson: unknown;
  readonly offline: boolean;
  readonly latest?: PiPinnedVersions;
  readonly now?: string;
}): PiCompatReport {
  const findings: string[] = [];

  let pinned = UNKNOWN_PINNED_VERSIONS;
  let pinsReadable = false;
  let pinsComparable = false;
  try {
    pinned = readPinnedPiVersions(input.packageJson);
    pinsReadable = true;
  } catch (error: unknown) {
    findings.push(`BROKEN: unreadable Pi package pins: ${errorText(error)}`);
  }
  if (pinsReadable) {
    pinsComparable = validatePinnedVersions(pinned, findings);
  }

  const adapterInspection = inspectAdapterForReport(findings);
  if (adapterInspection.assumedNestedSkillDiscovery) {
    findings.push("assumed nested skill discovery (Pi 0.84.3)");
  }
  if (adapterInspection.probe.googleThinkingType === "legacy-GoogleThinkingLevel") {
    findings.push("BROKEN: adapter references legacy GoogleThinkingLevel");
  }

  let status: PiCompatReport["status"] = "unknown";
  if (pinsComparable && input.latest !== undefined) {
    status = comparePackagePairs(pinned, input.latest, findings);
  } else if (pinsComparable) {
    findings.push(
      input.offline
        ? "offline compatibility check has no latest Pi versions to compare"
        : "latest Pi versions unavailable; compatibility comparison not performed"
    );
  }

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    offline: input.offline,
    pinned,
    ...(input.latest !== undefined ? { latest: input.latest } : {}),
    adapter: adapterInspection.probe,
    status,
    findings
  };
}

function validatePinnedVersions(pinned: PiPinnedVersions, findings: string[]): boolean {
  let valid = true;
  for (const [packageName, version] of [
    ["@earendil-works/pi-agent-core", pinned.agentCore],
    ["@earendil-works/pi-ai", pinned.ai]
  ] as const) {
    try {
      comparePiVersions(version, version);
    } catch (error: unknown) {
      valid = false;
      findings.push(`${packageName} pin is incomparable: ${errorText(error)}`);
    }
  }
  return valid;
}

function comparePackagePairs(
  pinned: PiPinnedVersions,
  latest: PiPinnedVersions,
  findings: string[]
): PiCompatReport["status"] {
  const comparisons: ComparableStatus[] = [];
  comparePackage("@earendil-works/pi-agent-core", pinned.agentCore, latest.agentCore, comparisons, findings);
  comparePackage("@earendil-works/pi-ai", pinned.ai, latest.ai, comparisons, findings);

  if (comparisons.length !== 2) return "unknown";
  if (comparisons.includes("behind")) return "behind";
  if (comparisons.includes("ahead")) return "ahead";
  return "current";
}

function comparePackage(
  packageName: string,
  pinned: string,
  latest: string,
  comparisons: ComparableStatus[],
  findings: string[]
): void {
  try {
    const comparison = comparePiVersions(pinned, latest);
    comparisons.push(comparison);
    if (comparison !== "current") {
      findings.push(`${packageName} pin ${pinned} is ${comparison} latest ${latest}`);
    }
  } catch (error: unknown) {
    findings.push(`${packageName} versions are incomparable: ${errorText(error)}`);
  }
}

function inspectAdapterForReport(findings: string[]): AdapterInspection {
  try {
    return inspectAdapterSource(readDefaultAdapterSource());
  } catch (error: unknown) {
    findings.push(`BROKEN: unable to read Pi adapter sources: ${errorText(error)}`);
    return {
      probe: {
        thinkingLevels: [...SPARKLE_THINKING_LEVELS],
        googleThinkingType: "absent",
        nestedSkillDiscovery: true,
        agentsMdNotBrokenSkill: true
      },
      assumedNestedSkillDiscovery: true
    };
  }
}

function inspectAdapterSource(source: string): AdapterInspection {
  const hasLegacyGoogleThinkingType = /\bGoogleThinkingLevel\b/.test(source);
  const hasApiGoogleThinkingType = /\bGoogleApiThinkingLevel\b/.test(source);
  const hasNestedSkillEvidence =
    /\bnested\b[\s\S]{0,100}\b(?:skill|group(?:ing|ed|s)?)\b/i.test(source) ||
    /\b(?:skill|group(?:ing|ed|s)?)\b[\s\S]{0,100}\bnested\b/i.test(source);

  return {
    probe: {
      thinkingLevels: [...SPARKLE_THINKING_LEVELS],
      googleThinkingType: hasLegacyGoogleThinkingType
        ? "legacy-GoogleThinkingLevel"
        : hasApiGoogleThinkingType
          ? "GoogleApiThinkingLevel"
          : "absent",
      nestedSkillDiscovery: true,
      agentsMdNotBrokenSkill: true
    },
    assumedNestedSkillDiscovery: !hasNestedSkillEvidence
  };
}

function readDefaultAdapterSource(): string {
  const requiredSources: ReadonlyArray<{
    readonly label: string;
    readonly candidates: readonly URL[];
  }> = [
    {
      label: "pi-executor",
      candidates: [
        new URL("../pi-adapter/pi-executor.ts", import.meta.url),
        new URL("../pi-adapter/pi-executor.js", import.meta.url)
      ]
    },
    {
      label: "runtime",
      candidates: [
        new URL("../pi-adapter/runtime.ts", import.meta.url),
        new URL("../pi-adapter/runtime.js", import.meta.url)
      ]
    }
  ];
  const optionalEvidenceSources = [
    new URL("../../.agents/skills/pi-sparkle/SKILL.md", import.meta.url),
    new URL("../../docs/how-to-adapt-to-pi.md", import.meta.url)
  ];

  const sourceParts = requiredSources.map(({ candidates, label }) =>
    readFirstExistingSource(candidates, label)
  );
  for (const path of optionalEvidenceSources) {
    if (existsSync(path)) sourceParts.push(readFileSync(path, "utf8"));
  }
  return sourceParts.join("\n");
}

function readFirstExistingSource(paths: readonly URL[], label: string): string {
  const path = paths.find((candidate) => existsSync(candidate));
  if (path === undefined) {
    throw new Error(`Pi adapter source ${label} was not found relative to ${import.meta.url}`);
  }
  return readFileSync(path, "utf8");
}

function parseVersion(version: string): readonly [bigint, bigint, bigint] {
  const match = VERSION_PATTERN.exec(version);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Invalid Pi version "${version}"; expected numeric major.minor.patch`);
  }
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

function readDependencyVersion(dependencies: Readonly<Record<string, unknown>>, name: string): string {
  const version = dependencies[name];
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`Cannot read pinned Pi version: dependency ${name} is missing`);
  }
  return version;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
