import { listObservations } from "./store.js";
import type { PreferenceScope } from "./types.js";

export function inspectPreferences(scope?: PreferenceScope): void {
  const obs = listObservations(scope);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ count: obs.length, observations: obs }, null, 2));
}

export function exportPreferences(scope?: PreferenceScope): string {
  return JSON.stringify(listObservations(scope), null, 2);
}

export function deletePreference(_id: string): boolean {
  // Placeholder: real impl removes from durable store
  return true;
}
