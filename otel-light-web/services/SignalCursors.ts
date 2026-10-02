// Helpers for composite keyset pagination on (time, id) cursors.
// The analytics API orders signals by time DESC, id DESC and compares
// records strictly: older pages use `before`/`before<Id>`, refresh uses
// `afterTime`/`after<Id>`.

export interface SignalCursor {
  time: number;
  id: string;
}

// Orders cursors the same way as the API: time first, then id, both DESC.
export function SignalCursorCompare(
  a: SignalCursor,
  b: SignalCursor,
): number {
  if (a.time !== b.time) {
    return a.time < b.time ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

// Returns the cursor of the newest of the two items.
export function SignalCursorMax(
  a: SignalCursor,
  b: SignalCursor,
): SignalCursor {
  return SignalCursorCompare(a, b) >= 0 ? a : b;
}

// Filters out items whose id was already seen (either in `seen` or earlier in
// `items`) and records the kept ids in `seen` for subsequent dedup passes.
export function SignalDedupeById<T>(
  items: T[],
  getId: (item: T) => string,
  seen?: Set<string>,
): T[] {
  const knownIds = seen ?? new Set<string>();
  const result: T[] = [];
  for (const item of items || []) {
    const id = getId(item);
    if (id === undefined || id === null || knownIds.has(id)) {
      continue;
    }
    knownIds.add(id);
    result.push(item);
  }
  return result;
}

// Appends a query string parameter to an existing (possibly empty) query
// string, URL-encoding the value.
export function SignalQueryAdd(
  queryString: string,
  key: string,
  value: string | number,
): string {
  const param = `${key}=${encodeURIComponent(String(value))}`;
  return queryString ? `${queryString}&${param}` : param;
}
