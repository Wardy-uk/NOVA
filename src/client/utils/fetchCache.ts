const inflight = new Map<string, { promise: Promise<unknown>; expires: number }>();
const DEDUP_MS = 2000;

export function cachedFetch<T = unknown>(url: string): Promise<T> {
  const now = Date.now();
  const existing = inflight.get(url);
  if (existing && existing.expires > now) return existing.promise as Promise<T>;

  const promise = fetch(url).then(r => r.json());
  inflight.set(url, { promise, expires: now + DEDUP_MS });
  promise.finally(() => {
    setTimeout(() => inflight.delete(url), DEDUP_MS);
  });
  return promise as Promise<T>;
}
