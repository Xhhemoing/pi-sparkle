#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";

const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);
const RELEASE_GATE_URL = new URL("../docs/specs/release-gate.md", import.meta.url);
const WORKSPACE_URL = new URL("../pnpm-workspace.yaml", import.meta.url);
const STATUS_HEADING = /^#{1,6}[ \t]+Status(?:[ \t]*:.*)?(?:[ \t]+#+)?[ \t]*$/im;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isSemverRange(value) {
  if (typeof value !== "string" || value.trim() === "") return false;

  const identifier = String.raw`(?:0|[1-9]\d*|[xX*])`;
  const suffix = String.raw`(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
  const version = String.raw`v?${identifier}(?:\.${identifier}){0,2}${suffix}`;
  const comparator = String.raw`(?:[~^]|<=?|>=?|=)?[ \t]*${version}`;
  const hyphenRange = String.raw`${version}[ \t]+-[ \t]+${version}`;
  const comparatorSet = String.raw`(?:${hyphenRange}|${comparator})(?:[ \t]+(?:${hyphenRange}|${comparator}))*`;
  return new RegExp(String.raw`^(?:${comparatorSet})(?:[ \t]*\|\|[ \t]*(?:${comparatorSet}))*$`).test(
    value.trim()
  );
}

function finding(check, ok, detail) {
  return { check, status: ok ? "ok" : "BLOCKED", detail };
}

const findings = [];
let packageJson;
let packageError;

try {
  packageJson = JSON.parse(await readFile(PACKAGE_JSON_URL, "utf8"));
} catch (error) {
  packageError = `package.json is unreadable or invalid: ${errorMessage(error)}`;
}

if (packageError !== undefined) {
  findings.push(
    finding("package-private", false, packageError),
    finding("node-engine", false, packageError),
    finding("bin-path", false, packageError)
  );
} else {
  const isPrivate = packageJson?.private === true;
  findings.push(
    finding(
      "package-private",
      isPrivate,
      isPrivate ? "package.json private is true" : "package.json private must be exactly true"
    )
  );

  const nodeEngine = packageJson?.engines?.node;
  const validNodeEngine = isSemverRange(nodeEngine);
  findings.push(
    finding(
      "node-engine",
      validNodeEngine,
      validNodeEngine
        ? `package.json engines.node is ${JSON.stringify(nodeEngine)}`
        : "package.json engines.node must be a non-empty semver range"
    )
  );

  const binPath = packageJson?.bin?.["pi-sparkle"];
  const validBinPath = binPath === "dist/cli/main.js";
  findings.push(
    finding(
      "bin-path",
      validBinPath,
      validBinPath
        ? "package.json bin.pi-sparkle points to dist/cli/main.js"
        : "package.json bin.pi-sparkle must equal dist/cli/main.js"
    )
  );
}

try {
  const releaseGate = await readFile(RELEASE_GATE_URL, "utf8");
  const hasStatusHeading = STATUS_HEADING.test(releaseGate);
  findings.push(
    finding(
      "release-gate-status",
      hasStatusHeading,
      hasStatusHeading
        ? "docs/specs/release-gate.md contains a Status heading"
        : "docs/specs/release-gate.md must contain a Status heading"
    )
  );
} catch (error) {
  findings.push(
    finding(
      "release-gate-status",
      false,
      `docs/specs/release-gate.md is unreadable or missing: ${errorMessage(error)}`
    )
  );
}

try {
  const workspaceStat = await stat(WORKSPACE_URL);
  findings.push(
    finding(
      "pnpm-workspace",
      workspaceStat.isFile(),
      workspaceStat.isFile()
        ? "pnpm-workspace.yaml exists"
        : "pnpm-workspace.yaml exists but is not a file"
    )
  );
} catch (error) {
  findings.push(
    finding(
      "pnpm-workspace",
      false,
      `pnpm-workspace.yaml is missing or unreadable: ${errorMessage(error)}`
    )
  );
}

const blocked = findings.some(({ status }) => status === "BLOCKED");
process.stdout.write(`${JSON.stringify({ status: blocked ? "BLOCKED" : "ok", findings }, null, 2)}\n`);
process.exitCode = blocked ? 1 : 0;
