export function tombstoneIds(ids: readonly string[]): ReadonlySet<string> {
  return new Set(ids);
}

export function materializeWithoutTombstones<T extends { id: string }>(
  items: readonly T[],
  tombstones: ReadonlySet<string>
): T[] {
  return items.filter((item) => !tombstones.has(item.id));
}
