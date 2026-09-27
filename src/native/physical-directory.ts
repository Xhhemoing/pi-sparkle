import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";

/** Normalize native spellings (including Windows 8.3 names), not directory links. */
export function physicalDirectoryWithoutLinks(value: string): string {
  const requested = path.resolve(value);
  let cursor = path.parse(requested).root;
  try {
    for (const component of requested.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, component);
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink()) {
        throw new DomainValidationError("repository path: directory link aliases are refused");
      }
      if (!entry.isDirectory()) {
        throw new DomainValidationError("repository path must be a directory");
      }
    }
    const canonical = realpathSync.native(requested);
    const before = statSync(requested, { bigint: true });
    const after = statSync(canonical, { bigint: true });
    if (!before.isDirectory() || !after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino) {
      throw new DomainValidationError("repository directory identity changed during resolution");
    }
    return canonical;
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    throw new DomainValidationError(`repository path is missing or inaccessible: ${requested}`);
  }
}
