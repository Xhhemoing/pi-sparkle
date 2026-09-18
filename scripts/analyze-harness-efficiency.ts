/**
 * Offline harness-efficiency aggregator (PR-A).
 *
 *   pnpm exec tsx scripts/analyze-harness-efficiency.ts \
 *     --input <jsonl> --evidence-class synthetic|observed --json
 *
 * Thin CLI over src/telemetry/harness-efficiency.ts. Does not write an
 * observation store and is not wired into the runtime CLI main.
 */
import {
  analyzeHarnessEfficiency,
  HarnessEfficiencyError,
  readEfficiencyJsonlFile,
  type EfficiencyReport
} from "../src/telemetry/harness-efficiency.js";

const USAGE = "usage: --input <jsonl> --evidence-class synthetic|observed --json\n";

function failUsage(): never {
  process.stderr.write(USAGE);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): {
  readonly input: string;
  readonly evidenceClass: EfficiencyReport["evidenceClass"];
} {
  let input: string | undefined;
  let evidenceClass: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--input" || arg === "--evidence-class") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) failUsage();
      if (arg === "--input") input = value;
      else evidenceClass = value;
      index += 1;
      continue;
    }
    failUsage();
  }

  if (!json || input === undefined) failUsage();
  if (evidenceClass !== "synthetic" && evidenceClass !== "observed") failUsage();
  return { input, evidenceClass };
}

async function main(): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch {
    process.stderr.write(USAGE);
    return 1;
  }

  try {
    const rows = await readEfficiencyJsonlFile(parsed.input);
    const report = analyzeHarnessEfficiency(rows, parsed.evidenceClass);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof HarnessEfficiencyError
        ? error.message
        : "read";
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

process.exitCode = await main();
