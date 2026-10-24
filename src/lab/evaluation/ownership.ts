import type { AdapterContext, DiffScope } from "./adapters.js";

export interface OwnershipRule {
  readonly pattern: RegExp;
  readonly owner: "episode" | "generated" | "user" | "unknown";
}

const DEFAULT_RULES: OwnershipRule[] = [
  { pattern: /\.generated\./, owner: "generated" },
  { pattern: /node_modules\//, owner: "unknown" },
  { pattern: /dist\//, owner: "generated" },
  { pattern: /\.lock$/, owner: "generated" },
];

export function classifyDiffScope(
  context: AdapterContext,
  allChanged: readonly string[],
  rules: readonly OwnershipRule[] = DEFAULT_RULES
): DiffScope {
  const episodeOwned: string[] = [];
  const unrelatedUser: string[] = [];
  const generated: string[] = [];
  const unknown: string[] = [];

  for (const path of allChanged) {
    let classified = false;

    for (const rule of rules) {
      if (rule.pattern.test(path)) {
        if (rule.owner === "generated") generated.push(path);
        else if (rule.owner === "unknown") unknown.push(path);
        classified = true;
        break;
      }
    }

    if (classified) continue;

    if (context.changeSet.includes(path)) {
      episodeOwned.push(path);
    } else {
      unrelatedUser.push(path);
    }
  }

  return { episodeOwned, unrelatedUser, generated, unknown };
}
