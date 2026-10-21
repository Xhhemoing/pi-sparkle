# Read GitHub issues into untrusted drafts

The experimental `development/github-import` module fetches current issue or pull
request facts without creating local tasks or writing to GitHub. Hosts opt in by
constructing the importer; there is no background subscription or CLI default.

```ts
import { GithubReceiptStore } from "pi-sparkle/dist/development/github-receipt-store.js";
import { GithubDraftImporter } from "pi-sparkle/dist/development/github-import.js";

const receipts = new GithubReceiptStore(receiptPath);
const importer = new GithubDraftImporter({
  apiOrigin: "https://api.github.com",
  expectedRepositoryId: hostSelectedRepositoryId,
  receipts,
  // credential: hostCredential, // optional explicit host credential
});
const result = await importer.import({
  deliveryId: hostDeliveryId,
  locator: { owner: "example", repository: "project", number: 12 },
  event: { name: "issues", action: "edited" },
}, { signal });
if (result.status === "draft") {
  showUntrustedDraft(result.draft);
}
```

The host selects a root API origin and immutable repository ID. Enterprise API
base paths are currently rejected. Requests use only GET, reject redirects and
share a response byte allowance and deadline across repository and issue reads.
Credentials are explicit inputs and are never read from ambient environment
variables or saved in receipts. Do not treat issue text as executable instructions.

Every accepted delivery fetches current facts, including duplicate, old and
expired deliveries. Issue and pull-request aliases share repository ID plus issue
number. Drafts carry `observedAt`, `sourceUpdatedAt` and
`trust: "untrusted-external-data"`; titles are limited to 1 KiB and bodies to
256 KiB in UTF-8. They grant no queue, recipe, acceptance or apply authority.

Results distinguish `draft`, `unavailable`, `not-found-or-hidden`,
`identity-mismatch`, `invalid-response`, `cancelled`, `deadline` and `rate-limited`.
A private-resource 404 does not establish deletion. Rate limits may include a
retry hint capped at one hour; the importer never sleeps or retries itself.
Invalid host inputs or unavailable/corrupt receipt storage reject the operation.

The receipt store retains at most 512 rows in a 1 MiB snapshot for seven days,
with a 4 KiB delivery-envelope limit. Smaller host limits are supported. It stores
only delivery/locator/event metadata and timestamps, never draft bodies, headers
or credentials. Identical duplicates preserve their original expiry; changed
metadata under a live delivery ID conflicts. Full unexpired capacity refuses.
This finite transport deduplication does not provide permanent business
idempotency or prove a fetch succeeded.

Receipt publication uses the existing local lock and atomic writer. HTTP runs
after the lock is released. Corrupt, linked, oversized or ambiguous missing
snapshots require host reconciliation. The deadline covers conforming fetch and
body streams, and late results are rejected when control returns. Arbitrary
injected host code remains cooperative; it cannot be forcibly stopped in process.

[Plan](superpowers/plans/2026-10-19-local-followons.md) and
[verification record](reports/2026-10-19-staged-continuation.md).
