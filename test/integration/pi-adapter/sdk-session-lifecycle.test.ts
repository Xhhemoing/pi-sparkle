import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { Type, createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { PiAgentExecutor } from '../../../src/pi-adapter/pi-executor.js';
import { createRunId, createTaskId, createAgentInstanceId } from '../../../src/domain/ids.js';
import type { ExecutionEvent } from '../../../src/execution/contract.js';

const directory = join(process.cwd(), '.agent_workspace', 'sdk-session-lifecycle');
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
}
async function bounded<T>(value: Promise<T>, label: string, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([value, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`bounded wait failed: ${label}`)), ms);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function abortLatch(signal: AbortSignal | undefined, observed: ReturnType<typeof latch>) {
  assert.ok(signal, 'actual callback must receive its cancellation signal');
  if (signal.aborted) observed.release();
  else signal.addEventListener('abort', observed.release, { once: true });
}
async function fixture(suffix: string, tools: AgentTool[] = [], signal = new AbortController().signal) {
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(join(directory, `${suffix}-${process.pid}-`));
  const faux = fauxProvider({ provider: `session-lifecycle-${suffix}`, models: [{ id: 'synthetic' }] });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = new PiAgentExecutor({ providerId: model.provider, modelId: model.id, models, tools, retry: { maxAttempts: 1 } });
  const iterator = executor.execute({
    runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
    workingDirectory: root, prompt: 'Synthetic regression; invoke only the requested controlled callback.',
  }, signal)[Symbol.asyncIterator]() as AsyncGenerator<ExecutionEvent>;
  return { root, faux, iterator };
}
async function advanceUntil(iterator: AsyncGenerator<ExecutionEvent>, predicate: (event: ExecutionEvent) => boolean) {
  const seen: ExecutionEvent[] = [];
  for (let index = 0; index < 30; index++) {
    const step = await bounded(iterator.next(), 'observable event before closing');
    assert.equal(step.done, false, 'execution must still be active before early return');
    seen.push(step.value);
    if (predicate(step.value)) return seen;
  }
  assert.fail('no requested observable event within bounded event count');
}

async function earlyReturnCase(t: TestContext, mode: 'held-tool' | 'held-response') {
  const entered = latch(), release = latch(), aborted = latch(), settled = latch();
  let callbackEntered = false, callbackSettled = false, returnCompleted = false, callbackSignalAborted = false;
  const controlled: AgentTool = {
    name: 'synthetic_boundary_tool', label: 'Synthetic boundary tool', description: 'Private synthetic callback', parameters: Type.Object({}),
    execute: async (_id, _args, signal) => {
      if (mode === 'held-tool') {
        abortLatch(signal, aborted);
        callbackEntered = true; entered.release();
        try { await release.promise; }
        finally { callbackSignalAborted = signal!.aborted; callbackSettled = true; settled.release(); }
      }
      return { content: [{ type: 'text', text: 'synthetic callback result' }], details: {} };
    },
  };
  const f = await fixture(mode, [controlled]);
  let returning: Promise<IteratorResult<ExecutionEvent>> | undefined;
  let evidence: Record<string, unknown> | undefined;
  try {
    if (mode === 'held-tool') {
      f.faux.setResponses([fauxAssistantMessage(fauxToolCall('synthetic_boundary_tool', {}))]);
    } else {
      f.faux.setResponses([
        fauxAssistantMessage(fauxToolCall('synthetic_boundary_tool', {})),
        async (_context, options) => {
          abortLatch(options?.signal, aborted);
          callbackEntered = true; entered.release();
          try { await release.promise; }
          finally { callbackSignalAborted = options!.signal!.aborted; callbackSettled = true; settled.release(); }
          return fauxAssistantMessage('synthetic held response released');
        },
      ]);
    }
    const seen = await advanceUntil(f.iterator, (event) => mode === 'held-tool'
      ? event.type === 'TOOL_STARTED' && event.toolName === controlled.name
      : event.type === 'TURN_FINISHED');
    await bounded(entered.promise, 'actual callback entry');
    // No iterator.next() is pending: the real outer generator is suspended at
    // a visible yield. This isolates return/finally settlement semantics.
    returning = f.iterator.return(undefined as never).then((value) => { returnCompleted = true; return value; });
    await bounded(aborted.promise, 'actual callback receives abort');
    await setImmediate();
    evidence = { mode, root: f.root, pid: process.pid, seen: seen.map((event) => event.type),
      providerCalls: f.faux.state.callCount, beforeRelease: { callbackSettled, returnCompleted } };
    t.diagnostic(JSON.stringify(evidence));
    assert.equal(callbackSettled, false, 'held callback must really remain blocked at the assertion');
    assert.equal(returnCompleted, false,
      'iterator.return() must wait for the actual held callback to settle, not merely request abort');
  } finally {
    release.release();
    if (returning === undefined) returning = f.iterator.return(undefined as never);
    const [cleanup] = await bounded(Promise.allSettled([returning]), 'iterator cleanup');
    assert.equal(cleanup?.status, 'fulfilled', 'iterator cleanup must settle successfully');
    // If entry was reached, wait for its real callback finally; never leave a
    // failed assertion's callback held in the background.
    if (callbackEntered) await bounded(settled.promise, 'held callback cleanup');
    await setImmediate();
    if (callbackEntered) assert.equal(callbackSignalAborted, true);
    t.diagnostic(JSON.stringify({ mode, afterRelease: { callbackSettled, returnCompleted, callbackSignalAborted }, providerCalls: f.faux.state.callCount }));
  }
}

test('held tool: iterator return waits for real tool settlement', { timeout: 20000 }, async (t) => {
  await earlyReturnCase(t, 'held-tool');
});

test('held response: iterator return waits for real provider settlement', { timeout: 20000 }, async (t) => {
  await earlyReturnCase(t, 'held-response');
});

test('session path: PiAgentExecutor invokes real AgentSession prompt', { timeout: 20000 }, async (t) => {
  let calls = 0;
  const original = AgentSession.prototype.prompt;
  AgentSession.prototype.prompt = async function(...args: Parameters<typeof original>) {
    calls++;
    return original.apply(this, args);
  };
  const f = await fixture('session-path');
  const events: ExecutionEvent[] = [];
  try {
    f.faux.setResponses([fauxAssistantMessage('synthetic session path probe complete')]);
    for await (const event of f.iterator) events.push(event);
    assert.equal(f.faux.state.callCount, 1, 'real current executor must complete a real faux provider call');
    assert.deepEqual(events.at(-1), { type: 'EXECUTION_FINISHED', outcome: 'SUCCESS' });
    t.diagnostic(JSON.stringify({ pid: process.pid, root: f.root, providerCalls: f.faux.state.callCount, sessionPromptCalls: calls, terminal: events.at(-1) }));
    assert.ok(calls > 0, 'worker must invoke AgentSession.prompt; a core Agent prompt is not SDK session migration');
  } finally {
    AgentSession.prototype.prompt = original;
    await bounded(f.iterator.return(undefined as never), 'session probe iterator cleanup');
  }
});

test('cancellation during SDK construction prevents prompt and provider dispatch', { timeout: 20000 }, async (t) => {
  const entered = latch(), release = latch();
  const abort = new AbortController();
  const originalCreate = ModelRuntime.create;
  t.mock.method(ModelRuntime, 'create', async function(...args: Parameters<typeof originalCreate>) {
    const runtime = await originalCreate.apply(ModelRuntime, args);
    entered.release();
    await release.promise;
    return runtime;
  });
  const prompt = t.mock.method(AgentSession.prototype, 'prompt');
  const f = await fixture('construction-abort', [], abort.signal);
  const events: ExecutionEvent[] = [];
  const running = (async () => { for await (const event of f.iterator) events.push(event); })();
  try {
    await bounded(entered.promise, 'real SDK runtime construction');
    abort.abort();
    release.release();
    await bounded(running, 'cancelled execution settlement');
    assert.equal(prompt.mock.callCount(), 0);
    assert.equal(f.faux.state.callCount, 0);
    assert.deepEqual(events.at(-1), { type: 'EXECUTION_FINISHED', outcome: 'CANCELLED' });
  } finally {
    release.release();
    abort.abort();
    await bounded(running, 'construction test cleanup');
  }
});
