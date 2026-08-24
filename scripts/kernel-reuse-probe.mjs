#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const EXECUTOR_PATH = join(REPO_ROOT, "src", "pi-adapter", "pi-executor.ts");
const KERNEL_PATH = join(REPO_ROOT, "src", "pi-adapter", "kernel.ts");

function liveYieldEvidence(source) {
  const subscribeAt = source.search(/\b(?:agent|kernel)\.subscribe\s*\(/);
  const pushedAt = source.search(/\.\s*(?:push|enqueue)\s*\(\s*translated\b/);
  const pulledAt = source.search(/\.\s*(?:shift|dequeue|next)\s*\(/);
  const yieldedAt = source.search(/\byield\b/);
  const awaitedIdleAt = source.search(/\bawait\s+(?:agent|kernel)\.waitForIdle\s*\(/);

  const subscribeBlock = source.match(
    /\b(?:agent|kernel)\.subscribe\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]{0,2500}?)\}\s*\)/
  );
  const yieldsFromSubscribe = subscribeBlock?.[1].includes("yield") ?? false;
  const asyncIterableQueue =
    subscribeAt >= 0 &&
    pushedAt > subscribeAt &&
    /\bfor\s+await\s*\([^)]*\bof\b[^)]*(?:queue|events?|stream)/i.test(source) &&
    /\byield\b/.test(source);
  const coordinatesProducerAndConsumer =
    /\bPromise\.race\s*\(|\b(?:Async\w*Queue|Deferred)\b|\b(?:wake|notify|waiter|resolver)s?\b/i.test(
      source
    );
  const queueFeedsYield =
    subscribeAt >= 0 &&
    pushedAt > subscribeAt &&
    pulledAt >= 0 &&
    yieldedAt >= 0 &&
    (coordinatesProducerAndConsumer ||
      awaitedIdleAt < 0 ||
      pulledAt < awaitedIdleAt);

  return yieldsFromSubscribe || asyncIterableQueue || queueFeedsYield;
}

function kernelExportsSteerText(source) {
  const exportsValue =
    /\bexport\s+(?:default\s+)?(?:class|function|const|let|var)\b/.test(source) ||
    /\bexport\s*\{[^}]*\}/s.test(source);
  return exportsValue && /\bsteerText\s*\(/.test(source);
}

function executorWiresSteerText(source) {
  return (
    /\bexport\s+class\s+PiAgentExecutor\b/.test(source) &&
    /\bsteerText\s*\(\s*text\s*:\s*string\s*\)/.test(source) &&
    /\.\s*steerText\s*\(\s*text\s*\)/.test(source)
  );
}

async function readSource(path) {
  try {
    return { source: await readFile(path, "utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function main() {
  const [executor, kernel] = await Promise.all([
    readSource(EXECUTOR_PATH),
    readSource(KERNEL_PATH)
  ]);

  const live = executor.source !== undefined && liveYieldEvidence(executor.source);
  if (live) {
    console.log("PASS live-stream: subscribe events feed an async yielding path");
  } else if (executor.error !== undefined) {
    console.log(`FAIL live-stream: cannot read src/pi-adapter/pi-executor.ts (${executor.error})`);
  } else {
    console.log("FAIL live-stream: events are buffered until idle before they are yielded");
  }

  const facade = kernel.source !== undefined && kernelExportsSteerText(kernel.source);
  if (facade) {
    console.log("PASS kernel-facade: src/pi-adapter/kernel.ts exports steerText");
  } else if (kernel.error !== undefined) {
    console.log(`FAIL kernel-facade: cannot read src/pi-adapter/kernel.ts (${kernel.error})`);
  } else {
    console.log("FAIL kernel-facade: src/pi-adapter/kernel.ts does not export steerText");
  }

  const executorSteer =
    executor.source !== undefined && executorWiresSteerText(executor.source);
  if (executorSteer) {
    console.log("PASS executor-steer: PiAgentExecutor forwards steerText to a live kernel");
  } else if (executor.error !== undefined) {
    console.log(`FAIL executor-steer: cannot read src/pi-adapter/pi-executor.ts (${executor.error})`);
  } else {
    console.log("FAIL executor-steer: PiAgentExecutor does not forward steerText to a live kernel");
  }

  return live && facade && executorSteer ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
