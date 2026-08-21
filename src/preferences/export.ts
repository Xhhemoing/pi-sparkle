import type { PreferenceScope } from "./types.js";
import { isTombstoned, listObservations, listTombstones } from "./store.js";

export interface ExportOptions {
  readonly includeTombstones?: boolean;
  readonly scopes?: PreferenceScope[];
}

export interface ExportResult {
  readonly count: number;
  readonly data: string;
  readonly scopes: PreferenceScope[];
  readonly exportedAt: string;
}

export function exportAuthorizedPreferences(
  options: ExportOptions = {}
): ExportResult {
  let observations = listObservations();

  if (options.scopes && options.scopes.length > 0) {
    observations = observations.filter((o) => options.scopes!.includes(o.scope));
  }

  const result = {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: observations.length,
    observations,
    // Tombstones are included only on explicit request so downstream
    // datasets can reproduce deletion semantics without leaking them by
    // default.
    ...(options.includeTombstones === true ? { tombstones: listTombstones() } : {}),
  };

  return {
    count: observations.length,
    data: JSON.stringify(result, null, 2),
    scopes: options.scopes ?? ["user", "project", "task-family", "role", "model"],
    exportedAt: result.exportedAt,
  };
}

export function exportForDataset(scope?: PreferenceScope): string {
  const obs = listObservations(scope).filter((o) => !isTombstoned(o.id));
  const safe = obs.map((o) => ({
    scope: o.scope,
    scopeKey: o.scopeKey,
    key: o.key,
    value: o.value,
    weight: o.weight,
    createdAt: o.createdAt,
  }));
  return JSON.stringify(
    {
      version: 1,
      observations: safe,
      // Tombstone ids always propagate so downstream datasets can drop deleted
      // source payloads. The payloads themselves are never exported.
      tombstones: listTombstones(),
    },
    null,
    2
  );
}
