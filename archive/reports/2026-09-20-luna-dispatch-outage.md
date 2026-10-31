# Independent-review dispatch failure — native apply registration, 2026-09-20 (session 2)

## What was attempted

Three subagent dispatches (`mu9qfs2m-4487b3b1`, `mu9qi026-0565c0d3`, `mu9qil6b-ed49a569`, each with `retries: 5` per the owner batch convention) of the luna-fast independent review for `1707c8f` (native apply registration slice, base `cf1f0da6`). All failed before start. Review protocol was fully self-contained (worktree checkout of `1707c8f`, scope check `cf1f0da6..1707c8f`, boundary-claim code verification, focused native unit 23 + integration 15, typecheck, verdict to `.agent_workspace/luna-apply-reg-review/verdict.md`).

## Root cause: relay-wide upstream outage (not repo, not transport-local)

Direct relay probes (2026-09-20, this session, using the stored xhh credential; key redacted):

| Probe | Result |
|---|---|
| `GET /v1/models` | 200 OK — 27 models listed, gateway itself alive |
| `gpt-5.6-luna-fast` chat (twice, 10s apart) | `upstream_error` — `upstream: cursor`, `upstream_code: ERROR_NOT_LOGGED_IN`, `retryable: false` |
| `cursor-grok-4.6-fast` | same `ERROR_NOT_LOGGED_IN` |
| `claude-opus-5-fast`, `grok-4.6`, `kimi-k3`, `claude-fable-5`, `gemini-3.7-flash`, `gpt-5.6-luna` | all identical upstream auth errors |
| `gpt-5.6-sol-fast` | `model_not_allowed` (group config issue, distinct) |

Diagnosis: the xhh relay's **cursor upstream accounts are logged out** — every model that maps to `upstream: cursor` fails with `ERROR_NOT_LOGGED_IN` regardless of tier (fast and non-fast). This is the relay-side outage, consistent with the standing open item "xhh relay group-config / upstream stability" (grok-fast 404/402 track). It is not fixable from this repository.

The successful luna-fast reviews earlier on 2026-09-20 (`mu8o8s6k`, `mu97nour`/`mu97ygai`, `mu9j51je`) ran while the upstream accounts were still logged in; the outage began between `mu9j51je` and this session's attempts.

## Recorded disposition

- Independent review for the registration slice **remains open** and is now blocked on relay recovery, not on repository work.
- Do not silently fall back to another channel: owner designation is explicit for luna-fast, and no alternate reviewer is authorized.
- When the relay recovers (probe: `POST /v1/chat/completions` `gpt-5.6-luna-fast` returns 200), re-dispatch using the turnkey protocol preserved in the dispatch transcripts (`mu9qfs2m` task text): worktree `1707c8f`, scope check, boundary claims (a)–(h), focused unit 23 / integration 15, typecheck, verdict file.
- The slice itself remains verified by author-run commands (focused 38, serialized full suite 2816/0/18, probes) — recorded in the verification record; this is implementation evidence, not independent verification.
