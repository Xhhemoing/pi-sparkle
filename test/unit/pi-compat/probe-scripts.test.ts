import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const latestCheckPath = join(repoRoot, "scripts/pi-latest-check.mjs");

interface RunResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

function runLatestCheck(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>
): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PI_COMPAT_OFFLINE;
  Object.assign(env, environment);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [latestCheckPath, ...arguments_], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

async function withFakeRegistry<T>(
  version: string,
  run: (registryUrl: string, requests: string[]) => Promise<T>
): Promise<T> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ version }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    return await run(`http://127.0.0.1:${(address as AddressInfo).port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test("--offline and PI_COMPAT_OFFLINE=1 never contact the registry", async () => {
  await withFakeRegistry("999.0.0", async (registryUrl, requests) => {
    const flagResult = await runLatestCheck(["--offline"], {
      PI_COMPAT_REGISTRY_URL: registryUrl
    });
    const environmentResult = await runLatestCheck([], {
      PI_COMPAT_OFFLINE: "1",
      PI_COMPAT_REGISTRY_URL: registryUrl
    });

    assert.equal(flagResult.code, 0);
    assert.equal(environmentResult.code, 0);
    assert.deepEqual(requests, []);
    assert.doesNotMatch(flagResult.stdout, /^LATEST /m);
    assert.doesNotMatch(environmentResult.stdout, /^LATEST /m);
  });
});

test("--strict exits 1 when fake registry versions are ahead of pinned versions", async () => {
  await withFakeRegistry("999.0.0", async (registryUrl, requests) => {
    const result = await runLatestCheck(["--strict"], {
      PI_COMPAT_REGISTRY_URL: registryUrl
    });

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(requests.length, 3);
    assert.match(result.stdout, /STATUS @earendil-works\/pi-agent-core: behind/);
    assert.match(result.stdout, /STATUS @earendil-works\/pi-ai: behind/);
  });
});
