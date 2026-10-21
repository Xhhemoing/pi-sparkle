import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { GithubDraftImporter } from "../../../src/development/github-import.js";
import { GithubReceiptStore } from "../../../src/development/github-receipt-store.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const delivery = (deliveryId = "delivery-1", action = "edited") => ({ deliveryId,
  locator: { owner: "Example", repository: "Repo", number: 7 }, event: { name: "issues" as const, action } });
const issue = (title = "current title", extra = {}) => ({ number: 7, title, body: "untrusted body",
  updated_at: "2026-10-19T12:00:00Z", ...extra });
function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data));
}
async function fixture(body: (value: { root: string; origin: string; receipts: GithubReceiptStore;
  requests: { method: string; url: string; auth: string | undefined }[];
  respond: (handler: (req: IncomingMessage, res: ServerResponse) => void) => void;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-gh-import-"));
  const requests: { method: string; url: string; auth: string | undefined }[] = [];
  let handler = (_req: IncomingMessage, res: ServerResponse) => json(res, issue());
  const server = createServer((req, res) => {
    requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  try { await body({ root, origin: `http://127.0.0.1:${address.port}`, receipts: new GithubReceiptStore(join(root, "receipts.json")),
    requests, respond: (value) => { handler = value; } }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}
function repoOr(req: IncomingMessage, res: ServerResponse, data: unknown = issue()): void {
  json(res, req.url === "/repos/example/repo" ? { id: 42 } : data);
}

test("loopback GET fetches current facts on duplicate and old deliveries, sharing issue/PR aliases", async () => fixture(async ({ origin, receipts, requests, respond, root }) => {
  let title = "new"; let pull = false;
  respond((req, res) => repoOr(req, res, issue(title, pull ? { id: 999, pull_request: { url: "https://evil.invalid" } } : { id: 123 })));
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts, credential: "explicit-secret" });
  const first = await importer.import(delivery()); assert.equal(first.status, "draft");
  if (first.status !== "draft") return;
  assert.equal(first.draft.title, "new"); assert.equal(first.draft.identity, "42:7"); assert.equal(first.draft.kind, "issue");
  assert.equal(first.draft.sourceUpdatedAt, "2026-10-19T12:00:00.000Z"); assert.ok(first.draft.observedAt);
  title = "newest"; pull = true;
  const duplicate = await importer.import(delivery()); assert.equal(duplicate.status, "draft");
  if (duplicate.status !== "draft") return;
  assert.equal(duplicate.receipt.duplicate, true); assert.equal(duplicate.draft.title, "newest");
  assert.equal(duplicate.draft.kind, "pull-request"); assert.equal(duplicate.draft.identity, first.draft.identity);
  const old = await importer.import(delivery("old-event", "opened")); assert.equal(old.status, "draft");
  assert.deepEqual(requests.map((req) => req.url), Array(3).fill(["/repos/example/repo", "/repos/example/repo/issues/7"]).flat());
  assert.ok(requests.every((req) => req.method === "GET" && req.auth === "Bearer explicit-secret"));
  const bytes = await readFile(join(root, "receipts.json"), "utf8");
  for (const secret of ["explicit-secret", "newest", "untrusted body", "authorization"]) assert.equal(bytes.includes(secret), false);
}));

test("identity mismatch prevents issue lookup and redirects are never followed", async () => fixture(async ({ origin, receipts, requests, respond }) => {
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  respond((_req, res) => json(res, { id: 43 }));
  assert.equal((await importer.import(delivery())).status, "identity-mismatch"); assert.equal(requests.length, 1);
  respond((_req, res) => { res.writeHead(302, { location: `${origin}/elsewhere` }); res.end(); });
  assert.equal((await importer.import(delivery())).status, "unavailable"); assert.equal(requests.length, 2);
  assert.equal(requests[1]!.auth, undefined);
}));

test("auth, hidden404 and rate-limit preserve conservative meanings without retry", async () => fixture(async ({ origin, receipts, requests, respond }) => {
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  for (const [code, expected] of [[401, "unavailable"], [403, "unavailable"], [404, "not-found-or-hidden"], [429, "rate-limited"]] as const) {
    respond((_req, res) => { res.writeHead(code, { "retry-after": "99999999999" }); res.end("not JSON"); });
    const value = await importer.import(delivery()); assert.equal(value.status, expected);
    if (value.status === "rate-limited") assert.equal(value.retryAfterMs, 3_600_000);
  }
  assert.equal(requests.length, 4);
}));

test("dropped response leaves receipt and duplicate redelivery performs new GETs", async () => fixture(async ({ origin, receipts, respond, requests }) => {
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  respond((_req, res) => res.destroy());
  assert.equal((await importer.import(delivery())).status, "unavailable"); assert.equal((await receipts.load()).length, 1);
  respond(repoOr);
  const value = await importer.import(delivery()); assert.equal(value.status, "draft");
  if (value.status === "draft") assert.equal(value.receipt.duplicate, true);
  assert.equal(requests.length, 3);
}));

test("actual streamed oversize, malformed and bounded draft fields refuse", async () => fixture(async ({ origin, receipts, respond }) => {
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts, maxResponseBytes: 300 });
  respond((req, res) => {
    if (req.url === "/repos/example/repo") return json(res, { id: 42 });
    res.writeHead(200); res.write("{"); res.end("x".repeat(1000));
  });
  assert.equal((await importer.import(delivery())).status, "invalid-response");
  respond((req, res) => { if (req.url === "/repos/example/repo") json(res, { id: 42 }); else res.end("{"); });
  assert.equal((await importer.import(delivery())).status, "invalid-response");
  respond((req, res) => repoOr(req, res, issue("x".repeat(1100))));
  const larger = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  assert.equal((await larger.import(delivery())).status, "invalid-response");
}));

test("actual slow headers/body obey shared total deadline and cancellation", async () => fixture(async ({ origin, receipts, respond }) => {
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts, timeoutMs: 120 });
  respond((_req, _res) => undefined);
  let start = Date.now(); assert.equal((await importer.import(delivery())).status, "deadline"); assert.ok(Date.now() - start < 1500);
  respond((req, res) => { if (req.url === "/repos/example/repo") json(res, { id: 42 }); else { res.writeHead(200); res.write('{"number":'); } });
  start = Date.now(); assert.equal((await importer.import(delivery())).status, "deadline"); assert.ok(Date.now() - start < 1500);
  const abort = new AbortController(); const pending = importer.import(delivery(), { signal: abort.signal });
  setTimeout(() => abort.abort(), 30); assert.equal((await pending).status, "cancelled");
  const prior = new AbortController(); prior.abort(); assert.equal((await importer.import(delivery(), { signal: prior.signal })).status, "cancelled");
  respond((req, res) => { const timer = setTimeout(() => repoOr(req, res), 80); res.on("close", () => clearTimeout(timer)); });
  start = Date.now(); assert.equal((await importer.import(delivery())).status, "deadline"); assert.ok(Date.now() - start < 1500, "deadline must not reset for issue leg");
}));

test("host config and delivery snapshot before await; reject arbitrary/path origins and ambient auth", async () => fixture(async ({ origin, receipts, requests, respond }) => {
  respond(repoOr);
  const options = { apiOrigin: origin, expectedRepositoryId: 42, receipts, credential: "explicit" };
  const importer = new GithubDraftImporter(options); options.apiOrigin = "https://evil.invalid"; options.credential = "changed";
  const input = delivery(); const pending = importer.import(input); input.locator.owner = "elsewhere"; input.locator.number = 99;
  assert.equal((await pending).status, "draft"); assert.equal(requests[0]!.auth, "Bearer explicit");
  const anonymous = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "ambient-secret";
  try { assert.equal((await anonymous.import(delivery("anonymous"))).status, "draft"); }
  finally { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; }
  assert.equal(requests.at(-1)!.auth, undefined);
  for (const apiOrigin of [`${origin}/api/v3`, `${origin}/?query=x`, `${origin}/#fragment`, "ftp://example.com", "https://u:p@example.com"]) {
    assert.throws(() => new GithubDraftImporter({ apiOrigin, expectedRepositoryId: 42, receipts }));
  }
  await assert.rejects(importer.import({ ...delivery("bad"), locator: { owner: "../evil", repository: "r", number: 1 } }));
}));

function git(cwd: string, args: string[]): void {
  const value = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }); assert.equal(value.status, 0, value.stderr);
}
test("connector-only leaves queue/ledger bytes unchanged and held connector permits actual unrelated runNext", async () => fixture(async ({ root, origin, receipts, respond }) => {
  const source = join(root, "source"); await mkdir(source); git(source, ["init"]);
  git(source, ["config", "user.name", "Fixture"]); git(source, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(source, "a.txt"), "before", "utf8"); git(source, ["add", "."]); git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const controller = new DevelopmentController({ sourceRepo: source, queuePath: join(root, "queue.json"), stateRoot: join(root, "state"),
    sandboxRoot: join(root, "candidates"), owner: "host:github-test", executorFactory: ({ tools }) => ({ async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "a.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
  await controller.store.create(createWorkQueue({ id: "local", authorityRef: "host:test", items: [{ id: "local", goal: "Fix a", dependencies: [], allowedScope: ["a.txt"], priority: 1,
    acceptance: [{ id: "a", command: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('a.txt','utf8')!=='after')process.exit(1)"], verifierVersion: "v1" }] }] }));
  const queueBefore = await readFile(join(root, "queue.json")); const actionsBefore = await controller.ledger.list();
  const ledgerPath = join(root, "actions", "actions.json"); const ledgerBefore = await readFile(ledgerPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; });
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts, timeoutMs: 300_000 });
  respond(repoOr); assert.equal((await importer.import(delivery())).status, "draft");
  assert.deepEqual(await readFile(join(root, "queue.json")), queueBefore);
  assert.deepEqual(await readFile(ledgerPath).catch(() => undefined), ledgerBefore);
  respond((_req, res) => json(res, {}, 503)); assert.equal((await importer.import(delivery())).status, "unavailable");
  assert.deepEqual(await readFile(join(root, "queue.json")), queueBefore); assert.deepEqual(await controller.ledger.list(), actionsBefore);
  assert.deepEqual(await readFile(ledgerPath).catch(() => undefined), ledgerBefore);
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  let held: ServerResponse | undefined; respond((_req, res) => { held = res; entered(); });
  const pending = importer.import(delivery()); await started;
  assert.equal((await receipts.receive(delivery("parallel-receipt"))).duplicate, false, "HTTP wait must not retain receipt lock");
  try {
    const result = await controller.runNext(); assert.equal(result.status, "ready-for-review");
    assert.equal((await controller.store.load()).items[0]!.status, "ready-for-review");
    assert.equal((await controller.ledger.list()).filter((entry) => entry.kind === "candidate-write" && entry.state === "completed").length, 1);
    assert.equal(await readFile(join(result.candidatePath!, "a.txt"), "utf8"), "after");
  } finally { held!.destroy(); }
  assert.equal((await pending).status, "unavailable");
}));



test("expired receipt is reaccepted and still fetches current facts; full live store starts zero requests", async () => fixture(async ({ root, origin, requests, respond }) => {
  let now = 1000; let title = "first";
  const receipts = new GithubReceiptStore(join(root, "short.json"), { now: () => now, retentionMs: 10, maxRows: 1 });
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  respond((req, res) => repoOr(req, res, issue(title)));
  const first = await importer.import(delivery()); assert.equal(first.status, "draft");
  await assert.rejects(importer.import(delivery("another")), /capacity/); assert.equal(requests.length, 2);
  now = 1010; title = "current after expiry";
  const next = await importer.import(delivery()); assert.equal(next.status, "draft");
  if (next.status === "draft" && first.status === "draft") {
    assert.equal(next.receipt.duplicate, false); assert.notEqual(next.receipt.receipt.id, first.receipt.receipt.id);
    assert.equal(next.draft.title, title);
  }
  assert.equal(requests.length, 4);
}));

test("repository and issue bodies consume one shared byte cap; malformed current facts never draft", async () => fixture(async ({ origin, receipts, respond }) => {
  const body = issue(); const issueBytes = Buffer.byteLength(JSON.stringify(body));
  const limited = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts, maxResponseBytes: issueBytes + 1 });
  respond((req, res) => repoOr(req, res, body)); assert.equal((await limited.import(delivery())).status, "invalid-response");
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  for (const bad of [issue("bad", { number: 8 }), issue("bad", { body: {} }), issue("bad", { updated_at: "yesterday" }),
    issue("bad", { body: "x".repeat(262145) }), issue("bad", { pull_request: null })]) {
    respond((req, res) => repoOr(req, res, bad)); assert.equal((await importer.import(delivery())).status, "invalid-response");
  }
}));

test("invalid host/input accessors reject with zero getter calls and zero HTTP", async () => fixture(async ({ origin, receipts, requests }) => {
  let getters = 0;
  assert.throws(() => new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts,
    get credential() { getters++; return "secret"; } }));
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts });
  await assert.rejects(importer.import({ ...delivery(), get locator() { getters++; return delivery().locator; } }));
  await assert.rejects(importer.import(delivery(), { get signal() { getters++; return new AbortController().signal; } }));
  assert.equal(getters, 0); assert.equal(requests.length, 0); assert.deepEqual(await receipts.load(), []);
}));

test("a trusted transport returning after the total deadline cannot publish a late draft", async () => fixture(async ({ origin, receipts, respond }) => {
  respond(repoOr);
  let lateReturn = false;
  const importer = new GithubDraftImporter({ apiOrigin: origin, expectedRepositoryId: 42, receipts, timeoutMs: 700,
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (!url.includes("/issues/")) return response;
      const body = await response.text(); lateReturn = true;
      // Deliberately block the trusted host thread: no hard termination is claimed,
      // but a late supported return must still fail after control returns.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
      return new Response(body, { status: 200 });
    } });
  assert.equal((await importer.import(delivery())).status, "deadline");
  assert.equal(lateReturn, true, "the late transport return was actually exercised");
}));
