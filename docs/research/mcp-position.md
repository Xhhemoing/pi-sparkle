# MCP position: why pi-sparkle does not speak it, and what would change that

- **Status:** Position note (research plane). Changes no code and advances no
  ADR. ADR-006 remains **Proposed**.
- **Date:** 2026-08-25 (all URLs marked "re-verified" were fetched live on
  this date).
- **Scope:** Answers the interop question "does pi-sparkle speak MCP?" as a
  documented decision instead of silence. It is not an implementation plan,
  and it does not recommend building an MCP client, server, or adapter in the
  current loop.
- **Relation to ADRs:** interprets ADR-001 (Accepted: Pi behind a
  version-pinned adapter, `src/pi-adapter/` only) and ADR-006 (Proposed:
  future inbound extension confined to `extensions/pi-sparkle/`, telemetry
  only). Nothing here modifies either.

## 1. The answer

**No. pi-sparkle speaks no MCP, in either direction, and that is an
architectural decision — not an omission waiting for a backlog slot.**

- **Not an MCP client.** The runtime attaches no external tool servers to
  its child agents.
- **Not an MCP server.** The runtime exposes no `run` / `inspect` / `resume`
  facade over MCP (or any protocol other than its own CLI and frozen JSON
  contracts).

The *because*: in this codebase, tools enter execution through exactly two
paths, and both sit behind the ADR-001 adapter boundary.

1. **The Pi kernel's own built-in tools.** Pi gives the model `read`,
   `write`, `edit`, and `bash` by default (further built-ins such as `grep`,
   `find`, `ls` are available via tool options). pi-sparkle drives that
   kernel through `src/pi-adapter/` and does not reach around it.
2. **Adapter-constructed `AgentTool`s.** The only tools pi-sparkle itself
   adds are built inside the adapter as Pi `AgentTool` values:
   `createClusterTools` in `src/pi-adapter/cluster-tools.ts` (peer messaging:
   `sparkle_send`, `sparkle_inbox`) and the terminal `report_task_result`
   tool in `src/pi-adapter/pi-executor.ts`. The executor merges them with any
   executor-option tools when constructing the agent. Because `AgentTool` is
   a Pi type and the import-boundary test (`test/unit/pi-boundary.test.ts`)
   forbids Pi imports outside `src/pi-adapter/`, no module elsewhere in the
   tree can even construct a tool.

There is no third ingress. Adding MCP would create one, and ADR-001's
consequence clause already states the rule for that: capabilities not
represented by the adapter "require an explicit domain-contract decision
before adoption." No such decision has been made, because no consumer has
presented a task that is blocked for the lack of one (see §5).

Verified local facts, 2026-08-25:

- `rg -i mcp src/ test/` returns nothing. The only MCP mentions in the repo
  are in research documents (`docs/research/`).
- `package.json#pi` declares only `skills` and `prompts`. There is no
  `pi.extensions` entry and no `@earendil-works/pi-coding-agent` dependency.
- ADR-006 is Proposed; `PI_EXTENSION_IMPORT_ALLOWED` stays `false`.

## 2. Four mechanisms that must not be conflated

Evaluators (and future contributors) tend to collapse these into one
"plugins?" checkbox. They are four different things with four different
privilege levels, and pi-sparkle's position is different for each.

| Mechanism | What it is | Who executes code | What it can enforce | pi-sparkle today |
|---|---|---|---|---|
| **MCP** (spec 2026-07-28) | Third-party *capability protocol*: out-of-process servers offering tools/resources/prompts to a host | An external server process | Nothing in the host — it attaches capability, it does not constrain the model | Not spoken, either direction (§1) |
| **Pi `ExtensionAPI`** | In-process TypeScript with full process privilege: `registerTool`, `registerCommand`, lifecycle events, tool replacement, custom UI | Extension code inside the Pi process | A real control plane — and Pi's own designated home for MCP support | Not used; no `pi.extensions` declared |
| **Diagnostic skill overlay** (`.agents/skills/pi-sparkle/`) | `SKILL.md` prompt text; Pi may or may not load it; loading is not compliance | Nobody — it is markdown the model may read | Nothing; it is forbidden to even record skill `USED` as if it were evidence (ADR-006) | Shipped, explicitly labeled "diagnostic overlay only; does not register extensions" |
| **ADR-006 inbound adapter** (future `extensions/pi-sparkle/`) | A Pi extension translating session/turn/tool events into pi-sparkle-owned telemetry records, with a kill switch | Extension code, confined to one directory, only after ADR-006 is Accepted | Telemetry capture only — explicitly *not* routing, promotion, or tool ingress | Proposed only; the import is forbidden until acceptance |

Two corollaries worth stating plainly:

- **None of these four is where an MCP client would live.** A consuming MCP
  adapter would be a *fifth* thing: a second protocol translated inside
  `src/pi-adapter/`, exactly the way Pi's own events and errors are
  translated there today. §5 states its preconditions.
- **The ADR-006 inbound adapter must not be widened to smuggle tool ingress.**
  Its scope is telemetry. "We already have an extension directory" would not
  be an argument for routing third-party capability through it.

The skill-vs-control-plane split is not a private opinion of this repo; it is
where the strongest current market practice landed. Claude Code's own
decision matrix states that a hook "always fires on its event; the trigger is
guaranteed" while for a skill "Claude interprets the instructions; outcome
can vary," and says outright: "An instruction like 'never edit `.env`' in
CLAUDE.md or a skill is a request, not a guarantee… If a rule must hold every
time, make it a hook rather than a prompt instruction"
([features-overview](https://code.claude.com/docs/en/features-overview),
official, re-verified 2026-08-25). That is ADR-006's thesis, productized by
the vendor with the largest extension taxonomy.

## 3. The host kernel is documented no-MCP — and points at extensions

Pi's official README states, under Philosophy: "**No MCP.** Build CLI tools
with READMEs (see Skills), or build an extension that adds MCP support"
([npm README](https://www.npmjs.com/package/@earendil-works/pi-coding-agent),
official, re-verified 2026-08-25; rationale linked from there:
[mariozechner.at, 2025-11-02](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)).
The same README lists "MCP server integration" as an example of what a Pi
*extension* can add.

The consequence for this repo: pi-sparkle consumes a kernel whose documented
answer to MCP is "that belongs in an extension" — and the extension surface
is precisely the one pi-sparkle has deliberately not built while ADR-006 is
Proposed. A runtime that smuggled an MCP client around its intentionally
minimal kernel would be fighting its own host, spending its one architectural
guarantee (all tool ingress behind one audited boundary) to acquire a surface
its host rejected on purpose. Pi's "CLI tools with READMEs" stance is also
the null hypothesis any MCP proposal must beat: most capabilities an
orchestrated child needs can be a CLI tool the child invokes through `bash`,
with zero new protocol surface.

## 4. The protocol itself: current state, and why waiting has cost nothing

Re-verified against the official changelog on 2026-08-25
([spec changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog);
release announcement:
[blog.modelcontextprotocol.io](https://blog.modelcontextprotocol.io/posts/2026-07-28/)):

- **2026-07-28 is the largest revision since launch.** It removes
  protocol-level sessions and the `initialize` handshake (stateless core,
  SEP-2575), replaces server-initiated requests with **MRTR** — the server
  returns `input_required` plus `inputRequests`, the client retries with
  `inputResponses` (SEP-2322) — and moves Tasks out of the core into an
  official extension with poll-based `tasks/get` / `tasks/update`
  (SEP-2663).
- **It deprecates Roots, Sampling, and Logging outright** (SEP-2577), under
  a new feature-lifecycle policy with a minimum twelve-month removal window.
  An early adopter who had wired those features in 2025 would now be
  migrating off them.
- Governance is foundation-owned (Linux Foundation / Agentic AI Foundation),
  and adoption across coding-assistant hosts is near-universal — Cursor,
  Copilot, Claude Code, Cline, Continue, Goose, Codex, Gemini CLI, OpenHands
  all consume it; Pi, Aider, and mini-SWE-agent are the documented
  refusals/abstentions (Round 1 survey, `.agent_workspace/r1-fable-a.md`
  §2.1 and `.agent_workspace/r1-gpt-b.md` §1, sources accessed 2026-08-25).

Two readings follow. First, MCP is real, foundation-governed infrastructure —
"we don't speak it" needs a reason, which §1 and §3 supply, not a shrug.
Second, the revision churn validates the abstention to date: the protocol's
own redesign converged *toward* shapes this runtime already has. MRTR's
state-on-server, client-retries pattern is how the CLI's `answer --run
--message` verb already works; poll-based Tasks is how `inspect` /
`--summary-json` already work. If a facade is ever justified, the mapping is
clean — nothing about waiting has created migration debt.

## 5. What would have to be true before a consuming MCP adapter is even discussable

These are preconditions for *opening the discussion* — recorded so a future
proposal has a bar to clear. Meeting them is not scheduled, and this note
recommends building nothing in the current loop. Any such adapter would live
**inside `src/pi-adapter/` only**, following the `cluster-tools.ts`
precedent: MCP-derived capabilities would surface as adapter-constructed
`AgentTool`s, and no MCP type would ever appear outside the adapter
directory.

1. **A named consumer with a recorded blocked task.** Concrete evidence that
   a real orchestrated run fails today because a needed capability exists
   only as an MCP server — *and* that Pi's null hypothesis (a CLI tool with
   a README, invoked via `bash`) demonstrably cannot serve it. "Evaluators
   expect MCP" is a perception fact (this note is the response to it), not a
   capability requirement.
2. **An explicit domain-contract decision, ADR-shaped.** Per ADR-001's
   consequence clause: how MCP tool results, errors, and progress translate
   into pi-sparkle-owned execution events; what happens on server crash
   mid-call (fail-closed, recorded, never invented); how the run's event log
   remains the sole source of truth. MCP would be a capability attachment,
   never the spine — the Round 1 survey's "don't steal Goose's
   everything-is-MCP purity" finding stands.
3. **An exact revision pin with characterization tests, before the first
   import.** The same discipline `docs/how-to-adapt-to-pi.md` applies to the
   Pi pin: pin one protocol revision (currently 2026-07-28), pin the SDK
   version, and extend the import-boundary tripwire so `mcp` specifiers
   outside `src/pi-adapter/` fail the suite — the tripwire lands *before*
   the dependency does.
4. **A telemetry-honesty story.** MCP tool calls must flow through the same
   invocation records as everything else, including the rule that unknown
   usage/cost persists as `undefined`, never zero. If a server's cost cannot
   be attributed, the cost gate must treat it as unpriced (gate not armed by
   guesswork) — and that interaction must be designed, not discovered.
5. **A trust and blast-radius posture.** An MCP server is an arbitrary
   third-party process. The real-executor path currently runs unsandboxed
   (a known gap vs the 2026 market bar); widening tool ingress before a
   sandbox story exists inverts the risk order. At minimum: an explicit
   server allowlist decision, and a statement of what the runtime does and
   does not vouch for.
6. **ADR-006 sequencing stays intact.** If the inbound extension is ever
   accepted, it remains telemetry-only; MCP ingress would still be a
   separate outbound-adapter contract. Neither decision may ride in on the
   other.

The producing direction — exposing this runtime *as* an MCP server (or ACP
agent) so editors can embed it — is a separate future decision with a
different cost/benefit shape (Round 1 open question #1). It is explicitly
not decided here, and nothing in this note forecloses it.

## 6. What this note does not change

- ADR-006 stays **Proposed**. No `extensions/` directory, no
  `package.json#pi.extensions`, no `@earendil-works/pi-coding-agent` import.
- No MCP client, server, SDK dependency, or protocol code anywhere in the
  tree. `rg -i mcp src/` returning nothing remains the checkable invariant;
  this document is the place that turns that empty grep from silence into a
  position.
- No status-matrix row moves; nothing becomes Outcome-supported.
- The runtime remains a local CLI with frozen JSON contracts as its only
  machine-readable surface.

## 7. Sources

Re-verified live on 2026-08-25 for this note:

| URL | Used for |
|---|---|
| https://modelcontextprotocol.io/specification/2026-07-28/changelog | Stateless core (SEP-2575), MRTR (SEP-2322), Tasks-as-extension with `tasks/get`/`tasks/update` polling and `tasks/list` removal (SEP-2663), Roots/Sampling/Logging deprecation (SEP-2577), feature-lifecycle policy |
| https://www.npmjs.com/package/@earendil-works/pi-coding-agent | Pi Philosophy "No MCP. Build CLI tools with READMEs, or build an extension that adds MCP support"; default four tools; extensions' "What's possible" including "MCP server integration"; Pi-package full-system-access security warning |
| https://code.claude.com/docs/en/features-overview | Hooks-vs-skills determinism ("Always fires on its event; the trigger is guaranteed" vs "Claude interprets the instructions; outcome can vary"); "a request, not a guarantee… hook … is enforcement" |

Carried from Round 1 (accessed 2026-08-25 by their authors; not re-fetched
for this note): the release announcement
(https://blog.modelcontextprotocol.io/posts/2026-07-28/), the MCP server
spec's tool/resource/prompt control model
(https://modelcontextprotocol.io/specification/2026-07-28/server), Goose's
extensions-are-MCP architecture
(https://block-goose.mintlify.app/concepts/extensions), Codex's dual MCP
client/server posture (https://developers.openai.com/codex/mcp), AAIF
governance and adoption-scale figures (industry-reported, third-party;
labeled as such in `.agent_workspace/r1-fable-a.md` §2.1). Local facts were
verified directly against the working tree as listed in §1.
