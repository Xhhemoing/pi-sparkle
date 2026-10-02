/**
 * Host-only candidate command grammar: exactly five nonempty arguments.
 * Quote an entire argument with single or double quotes when it has spaces.
 * Backslashes are literal, including UNC and trailing Windows separators.
 * This is deliberately not a shell parser: no escapes, expansion or execution.
 */
export function parseCandidateCommandArgs(input: string): readonly [string, string, string, string, string] {
  if (["\0", "\r", "\n", "\u2028", "\u2029"].some((character) => input.includes(character))) {
    throw new Error("Candidate arguments must be a single line without NUL characters");
  }
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    while (cursor < input.length && /\s/u.test(input[cursor]!)) cursor += 1;
    if (cursor === input.length) break;
    const quote = input[cursor];
    let value: string;
    if (quote === '"' || quote === "'") {
      const start = cursor + 1;
      const end = input.indexOf(quote, start);
      if (end === -1) throw new Error("Unclosed quoted candidate argument");
      value = input.slice(start, end);
      cursor = end + 1;
      if (cursor < input.length && !/\s/u.test(input[cursor]!)) {
        throw new Error("Quote the whole candidate argument; trailing characters are not allowed");
      }
    } else {
      const start = cursor;
      while (cursor < input.length && !/\s/u.test(input[cursor]!)) {
        if (input[cursor] === '"' || input[cursor] === "'") {
          throw new Error("Quote the whole candidate argument; embedded quotes are ambiguous");
        }
        cursor += 1;
      }
      value = input.slice(start, cursor);
    }
    if (value.trim() === "") throw new Error("Candidate arguments must not be empty");
    parts.push(value);
    if (parts.length > 5) throw new Error("Expected exactly five candidate arguments");
  }
  if (parts.length !== 5) throw new Error("Expected exactly five candidate arguments");
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!];
}

export interface CandidateDisposalArgs {
  readonly runId: string;
  readonly artifactId: string;
  readonly candidatePath: string;
  readonly sourceRepo: string;
  readonly stateRoot: string;
}

/**
 * Parse the host-only disposal command. JSON is preferred for paths containing
 * quotes; the five quoted positional arguments remain supported for existing
 * command-line habits. This parser performs no shell expansion or execution.
 */
export function parseCandidateDisposalArgs(input: string): CandidateDisposalArgs {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error("Disposal JSON is invalid");
    }
    if (parsed === null || typeof parsed !== "object") throw new Error("Disposal JSON must be an object");
    const record = parsed as Record<string, unknown>;
    const fields = ["runId", "artifactId", "candidatePath", "sourceRepo", "stateRoot"] as const;
    if (Object.keys(record).some((key) => !fields.includes(key as (typeof fields)[number]))) {
      throw new Error("Disposal JSON contains unknown fields");
    }
    if (fields.some((field) => typeof record[field] !== "string" || (record[field] as string).trim() === "")) {
      throw new Error("Disposal JSON fields must be nonempty strings");
    }
    return {
      runId: record.runId as string,
      artifactId: record.artifactId as string,
      candidatePath: record.candidatePath as string,
      sourceRepo: record.sourceRepo as string,
      stateRoot: record.stateRoot as string
    };
  }
  const [runId, artifactId, candidatePath, sourceRepo, stateRoot] = parseCandidateCommandArgs(input);
  return { runId, artifactId, candidatePath, sourceRepo, stateRoot };
}
