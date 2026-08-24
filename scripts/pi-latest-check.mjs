#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent"
];
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 5_000;
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

function parseArguments(arguments_) {
  const known = new Set(["--json", "--offline", "--strict"]);
  const unknown = arguments_.filter((argument) => !known.has(argument));
  if (unknown.length > 0) {
    throw new Error(`unknown argument${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  return {
    json: arguments_.includes("--json"),
    offline: arguments_.includes("--offline") || process.env.PI_COMPAT_OFFLINE === "1",
    strict: arguments_.includes("--strict")
  };
}

async function readPinnedVersions() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const dependencies =
    packageJson !== null &&
    typeof packageJson === "object" &&
    packageJson.dependencies !== null &&
    typeof packageJson.dependencies === "object"
      ? packageJson.dependencies
      : {};
  return Object.fromEntries(
    PACKAGES.map((packageName) => [
      packageName,
      typeof dependencies[packageName] === "string" ? dependencies[packageName] : null
    ])
  );
}

function normalizeRegistryUrl(value) {
  return value.replace(/\/+$/, "");
}

async function fetchLatestVersion(packageName, registryUrl, fetchImplementation) {
  try {
    const response = await fetchImplementation(`${registryUrl}/${packageName}/latest`, {
      headers: { accept: "application/json" },
      signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      return { version: null, error: `HTTP ${response.status}` };
    }
    const body = await response.json();
    if (body === null || typeof body !== "object" || typeof body.version !== "string") {
      return { version: null, error: "registry response has no version" };
    }
    return { version: body.version, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { version: null, error: message };
  }
}

function parseExactVersion(version) {
  if (typeof version !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim()
  );
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseExactVersion(leftVersion);
  const right = parseExactVersion(rightVersion);
  if (left === null || right === null) return null;

  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const comparison = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function packageStatus(pinned, latest) {
  if (latest === null) return "unknown";
  if (pinned === null) return "unpinned";
  const comparison = compareVersions(pinned, latest);
  if (comparison === null) return "unknown";
  if (comparison < 0) return "behind";
  if (comparison > 0) return "ahead";
  return "up-to-date";
}

function printPinned(pinned) {
  for (const packageName of PACKAGES) {
    console.log(`PINNED ${packageName}: ${pinned[packageName] ?? "(not pinned)"}`);
  }
}

function printResults(result, errors) {
  for (const packageName of PACKAGES) {
    console.log(`PINNED ${packageName}: ${result.pinned[packageName] ?? "(not pinned)"}`);
    console.log(`LATEST ${packageName}: ${result.latest[packageName] ?? "unknown"}`);
    const detail = errors[packageName] === null ? "" : ` (${errors[packageName]})`;
    console.log(`STATUS ${packageName}: ${result.status[packageName]}${detail}`);
  }
}

export async function main(
  arguments_ = process.argv.slice(2),
  {
    fetchImplementation = globalThis.fetch,
    registryUrl = process.env.PI_COMPAT_REGISTRY_URL ?? DEFAULT_REGISTRY_URL
  } = {}
) {
  let options;
  try {
    options = parseArguments(arguments_);
  } catch (error) {
    console.error(`pi-latest-check: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  let pinned;
  try {
    pinned = await readPinnedVersions();
  } catch (error) {
    console.error(
      `pi-latest-check: could not read ${REPO_ROOT}package.json: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return options.strict ? 1 : 0;
  }

  if (options.offline) {
    if (options.json) {
      console.log(
        JSON.stringify({
          pinned,
          latest: Object.fromEntries(PACKAGES.map((packageName) => [packageName, null])),
          status: Object.fromEntries(PACKAGES.map((packageName) => [packageName, "offline"]))
        })
      );
    } else {
      printPinned(pinned);
    }
    return 0;
  }

  if (typeof fetchImplementation !== "function") {
    console.error("pi-latest-check: fetch is unavailable");
    return options.strict ? 1 : 0;
  }

  const registry = normalizeRegistryUrl(registryUrl);
  const fetched = await Promise.all(
    PACKAGES.map((packageName) => fetchLatestVersion(packageName, registry, fetchImplementation))
  );
  const latest = Object.fromEntries(
    PACKAGES.map((packageName, index) => [packageName, fetched[index].version])
  );
  const errors = Object.fromEntries(
    PACKAGES.map((packageName, index) => [packageName, fetched[index].error])
  );
  const status = Object.fromEntries(
    PACKAGES.map((packageName) => [packageName, packageStatus(pinned[packageName], latest[packageName])])
  );
  const result = { pinned, latest, status };

  if (options.json) {
    console.log(JSON.stringify(result));
  } else {
    printResults(result, errors);
  }

  const hasBehindPin = PACKAGES.some(
    (packageName) => pinned[packageName] !== null && status[packageName] === "behind"
  );
  const hasUnknownFetch = fetched.some(({ version }) => version === null);
  return options.strict && (hasBehindPin || hasUnknownFetch) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
