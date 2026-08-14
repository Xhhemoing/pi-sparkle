import type { PreferenceView, PreferenceScope } from "./types.js";
import { buildView, getView } from "./store.js";

export interface MaterializedPreference {
  readonly view: PreferenceView;
  readonly effectiveKeys: Record<string, string | number | boolean>;
}

export function materializeView(
  scope: PreferenceScope,
  scopeKey: string
): MaterializedPreference {
  const view = buildView(scope, scopeKey);
  const effectiveKeys: Record<string, string | number | boolean> = {};

  for (const [k, v] of Object.entries(view.aggregates)) {
    effectiveKeys[k] = v;
  }

  return { view, effectiveKeys };
}

export function getMaterializedView(
  scope: PreferenceScope,
  scopeKey: string
): MaterializedPreference | undefined {
  const view = getView(scope, scopeKey);
  if (!view) return undefined;

  const effectiveKeys: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(view.aggregates)) {
    effectiveKeys[k] = v;
  }

  return { view, effectiveKeys };
}
