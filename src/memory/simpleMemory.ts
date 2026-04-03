const store = new Map<string, unknown>();

export function save(key: string, value: unknown): void {
  store.set(key, value);
}

export function get(key: string): unknown {
  return store.get(key);
}

export function getAll(): Record<string, unknown> {
  return Object.fromEntries(store.entries());
}
