# Conversation workflow proposal and daylight guide

- Task: `TASK-20261017-conversation-daylight-guide`; owner: Codex.
- Source baseline: PR #60 `14a11640a3a81b419b6789d167b57e6bb5780109`.
- Scope: documentation, presentation interaction and exports. [Plan](../superpowers/plans/2026-10-17-conversation-daylight-guide.md).
- Result: source review and author document/browser verification passed. Natural-language routing and conversation focus persistence are proposed work, not implemented runtime behavior.

## Design and source findings

The [conversation workflow](../../docs/conversation-workflow.md) defines structured intent,
host-resolved project/task/candidate references, shared CLI/conversation capabilities,
small-task execution, digressions and restoration, durable project facts, context
selection, task promotion and four proposed implementation slices. It preserves
current authority, checker ownership, effect settlement and the existing sources
of truth. It does not add mandatory per-message planners, model classifiers,
budget forms or project queues.

The actual extension has `sparkle_delegate` and issued-handle-gated
`sparkle_apply_candidate`; `sparkle-issue-candidate` remains host/user authority.
The experimental `startDevelopmentTask` already reuses NativeWriteSession, but
still needs a host executor and trusted verifier. WorkItemStore/controller already
provide project work facts. These findings informed the proposal; no natural-language
request execution or long-conversation recovery is claimed to have been tested here.

The guide now has 15 chapters, including two new chapters with eight manually
selectable panels for conversational actions and a main-task/side-task/resume
example. The diagram's direct-task text and the algorithm guide were corrected
to reflect the experimental entry already delivered by migration work.

Guide, map, SVG and derived PNG use explicit daylight backgrounds, dark text and
pale selected states. The no-toolbar and 48 px footer layout remains. Offline
exports rewrite only non-bundled references to GitHub and preserve local guide/map
navigation and the self-contained SVG download.

## Verification

Temporary harnesses are under `.agent_workspace/conversation-daylight/`.

| Check | Current result |
| --- | --- |
| `node .agent_workspace/conversation-daylight/check.mjs` | 59 assertions PASS; zero browser errors and external requests |
| Guide responsive and theme | 1440 / 768 / 390 / 320 px; white background even with dark OS preference; removed controls absent; 48 px footer; no page overflow |
| Chapters/panels | all 15 chapters; all eight new local panels; mobile selector, cold deep links and history PASS |
| Accessibility fallbacks | reduced motion honored; 15 chapters visible without JS and in print |
| Map | 32 nodes / 39 edges retained; selected-node behavior and actual SVG download PASS |
| SVG consistency | embedded main SVG, standalone SVG and downloaded SVG have identical bytes |
| Visual inspection | daylight overview, new desktop chapter, mobile continuity chapter and Chinese-readable full map inspected |
| ZIP/PNG | five exact archive members; 3840 × 4200 PNG; extracted guide ↔ map links PASS |
| Scoped link review | 407 local HTML/Markdown references, zero missing targets |
| `corepack pnpm@10.17.1 workflow:check` | PASS: 10 files / 16 required headings |
| `git diff --check` | PASS |

No runtime full gate, paid-provider evaluation or independent review was run for
this documentation-only delta. Existing migration evidence retains its own scope.
The browser checks validate the presentation, not intent recognition accuracy or
long-term memory effectiveness. Those require C1–C4 implementation and the proposed
scenario/authority/recovery checks. Main and separate PR #61 remain unchanged.
