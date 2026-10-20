import assert from "node:assert/strict";
import { createContributionHost, type DiagnosticData } from "pi-sparkle/sdk/host.js";

const observation: DiagnosticData = { findings: [{ severity: "warning", message: "Selected source requires independent review", path: "example.ts" }] };
const host = createContributionHost({ generationId: "consumer-2", capabilities: [], plugins: [{
  id: "review-advice", enabled: true, apiVersion: 1, requiredCapabilities: [], contributions: [{ kind: "diagnostic", id: "review" }],
  load: async () => [{ kind: "diagnostic", id: "review", diagnose: async () => observation }],
}] });
const request = { generationId: "consumer-2", revision: "revision-2", objective: "Review source", selectedFiles: [{ path: "example.ts" }] };
assert.deepEqual(await host.diagnose("review", request), { status: "available", generationId: "consumer-2", revision: "revision-2", value: observation });
assert.deepEqual(await host.diagnose("missing", request), { status: "unavailable", reason: "missing" });
await host.close();
