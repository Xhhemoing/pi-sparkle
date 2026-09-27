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
