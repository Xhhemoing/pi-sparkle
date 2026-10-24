import { DomainValidationError } from "../domain/errors.js";

function unsafeCharacters(value: string, selector: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127 || "\\:\ufffd".includes(character) || (selector && "{}[]()".includes(character))) return true;
  }
  return false;
}

/** A small path language, not shell/glob expansion. Matching is case-sensitive. */
export function normalizePathSelector(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || unsafeCharacters(value, true)) {
    throw new DomainValidationError("path selector must be a bounded safe relative slash-separated path");
  }
  const components = value.split("/");
  if (components.length > 128 || components.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || (part.includes("**") && part !== "**"))) {
    throw new DomainValidationError("path selector supports only literal components, * and ?, and whole-component ** outside .git");
  }
  return value;
}
export function hasPathPattern(value: string): boolean { return /[*?]/.test(value); }

function relativeComponents(value: string): string[] | undefined {
  if (typeof value !== "string" || unsafeCharacters(value, false)) return undefined;
  if (value === "") return [];
  const components = value.split("/");
  return components.length > 128 || components.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git") ? undefined : components;
}
/** Iterative component DP; ? consumes one Unicode code point, * stays in a component. */
function componentMatches(value: string, selector: string): boolean {
  const characters = Array.from(value);
  let previous = Array<boolean>(characters.length + 1).fill(false);
  previous[0] = true;
  for (const token of selector) {
    const next = Array<boolean>(characters.length + 1).fill(false);
    if (token === "*") next[0] = previous[0]!;
    for (let index = 1; index <= characters.length; index++) {
      next[index] = token === "*" ? previous[index]! || next[index - 1]!
        : previous[index - 1]! && (token === "?" || token === characters[index - 1]);
    }
    previous = next;
  }
  return previous[characters.length]!;
}
function statesAfter(relative: string, selector: string): { states: Set<number>; complete: number } | undefined {
  const pattern = normalizePathSelector(selector).split("/");
  const components = relativeComponents(relative);
  if (components === undefined) return undefined;
  const closure = (states: Set<number>): Set<number> => {
    for (const state of states) if (pattern[state] === "**") states.add(state + 1);
    return states;
  };
  let states = closure(new Set([0]));
  for (const component of components) {
    // A selected directory carries its subtree, even after the selector ends.
    if (states.has(pattern.length)) return { states, complete: pattern.length };
    const next = new Set<number>();
    for (const state of states) {
      if (pattern[state] === "**") next.add(state);
      else if (pattern[state] !== undefined && componentMatches(component, pattern[state]!)) next.add(state + 1);
    }
    states = closure(next);
    if (states.size === 0) break;
  }
  return { states, complete: pattern.length };
}
export function matchesPathSelector(relative: string, selector: string): boolean {
  const result = statesAfter(relative, selector);
  return result?.states.has(result.complete) ?? false;
}
/** Traversal hint only: a regular file satisfying this hint need not be selected. */
export function mayMatchPathDescendant(relative: string, selector: string): boolean {
  const result = statesAfter(relative, selector);
  return result !== undefined && result.states.size > 0;
}
