import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentInstanceId, createMessageId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { createMailbox } from "../../../src/cluster/mailbox.js";

test("role-cast mail is claimed by the first matching agent and skipped by the sender", () => {
  const mailbox = createMailbox();
  const scout = createAgentInstanceId();
  const impl = createAgentInstanceId();
  mailbox.enqueue({
    id: createMessageId(),
    from: scout,
    addressRole: "implementer",
    body: "found 3 files",
    occurredAt: nowIso()
  });
  mailbox.claimRole("scout", scout);
  assert.equal(mailbox.inbox(scout).length, 0);
  const delivered = mailbox.claimRole("implementer", impl);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.body, "found 3 files");
  assert.equal(mailbox.inbox(impl)[0]?.to, impl);
});

test("unicast mail lands only on the named agent", () => {
  const mailbox = createMailbox();
  const a = createAgentInstanceId();
  const b = createAgentInstanceId();
  mailbox.enqueue({
    id: createMessageId(),
    from: a,
    to: b,
    body: "hello",
    occurredAt: nowIso()
  });
  assert.equal(mailbox.inbox(a).length, 0);
  assert.equal(mailbox.drain(b)[0]?.body, "hello");
  assert.equal(mailbox.inbox(b).length, 0);
});
