# Loop 5 · Round 8 · D33 independent recheck

## Verdict: **FIX**

The landed source behavior at `8ca3026` is correct, but the escape rider's
regression test does not fully pin the exact contract it claims.

### Exact corrections

1. In
   `test/integration/m3/episode-cli.test.ts`, make **each**
   `requiredEvidence` entry contain a literal backslash, tab, CR, and LF, as
   required for every unconstrained evidence entry. The current fixture is:

   ```ts
   ["tests\tunit", "docs\nadr", "plain"]
   ```

   It contains no evidence-entry CR at all, no evidence-entry backslash, and
   its entries do not individually exercise all four replacements. Replace it
   with entries such as:

   ```ts
   ["tests\\one\tunit\r\nlinux", "docs\\two\tadr\r\nreview"]
   ```

   Then update the exact WAITING-line expectation accordingly and retain the
   decoded JSON deep-equality pin against the same unescaped array. Also
   correct the test/report assertion that every evidence entry already carries
   all four characters; it currently does not.

2. Make the claimed raw-JSONL pin genuinely byte-for-byte. The current helper
   and assertions apply `trimEnd().split("\n")` to both sides, which would pass
   after a lost, added, or changed trailing newline/whitespace sequence.
   Compare the strings directly instead:

   ```ts
   assert.equal(
     asJson.out.join(""),
     await readFile(join(episodesDir(stateRoot), `${episodeId}.events.jsonl`), "utf8")
   );
   ```

   Apply that direct comparison in both tests that claim raw-byte equality;
   keep the explicit parsed-event equality proving the originals remain
   unescaped.

No `src/cli/episode.ts` correction is needed. Its dispatch guard precedes the
required/malformed episode-id checks; both real subcommands retain the
specified malformed-id refusal; `humanField` performs backslash, tab, CR, LF
replacement in that order and is applied to every required field; the four
event formats have one physical line and two structural tabs; and the JSON
branch remains unchanged.

## Verification evidence

- `episode nonsense --episode banana` is pinned to the existing unknown-command
  report before episode-id validation.
- Malformed IDs are pinned on both `events` and `close`.
- Required focused test: **17/17 pass**.
- `src/episode/events.ts` and `src/cli/main.ts` are byte-identical to the base
  branch (matching Git blob IDs).
- `EPISODE_USAGE` is byte-identical (matching extracted-content hash
  `f62cc0eb0bd74156591ee8aead88e61d6d00aa8b`).
- `471fd3b` changes only the implementer report; `8ca3026` changes only
  `src/cli/episode.ts` and its integration test.
