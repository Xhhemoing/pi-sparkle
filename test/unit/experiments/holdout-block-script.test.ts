import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("holdout-block.mjs uses PS-P4 library (no C2 anti-patterns)", () => {
  it("script imports compileEquivalentArms and does not use tasks[0]/Date.now/placeholders", async () => {
    const source = await readFile(join(process.cwd(), "scripts/holdout-block.mjs"), "utf8");
    assert.match(source, /compileEquivalentArms/);
    assert.match(source, /validateHoldoutTaskSpec/);
    assert.match(source, /modelDescriptorsFromPriceTable/);
    assert.match(source, /--now-ms/);
    assert.doesNotMatch(source, /Date\.now\(\)/);
    assert.doesNotMatch(source, /taskFamily:\s*"holdout"/);
    assert.doesNotMatch(source, /inputCostPerMTok:\s*1,\s*\n\s*outputCostPerMTok:\s*1/);
    assert.doesNotMatch(source, /\(spec\.tasks\s*\?\?\s*\[\]\)\[0\]/);
  });
});
