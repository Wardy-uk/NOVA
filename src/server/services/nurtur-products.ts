/** Nurtur Product (customfield_13183) option list, cached process-wide.
 *
 *  Shared by the admin Team picker and the Dev Review product editor so both
 *  see the same list from one Jira fetch. All 'The Property Jungle' variants
 *  collapse to a single 'TPJ' entry to match productToTeam().
 */
import type { JiraRestClient } from './jira-client.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache: { products: string[]; fetchedAt: number } | null = null;

export interface NurturProductList {
  products: string[];
  cached: boolean;
  fetchedAt: number;
}

export async function getNurturProducts(
  client: JiraRestClient,
  force = false,
): Promise<NurturProductList> {
  if (cache && !force && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
    return { products: cache.products, cached: true, fetchedAt: cache.fetchedAt };
  }
  const raw = await client.getFieldOptions('customfield_13183');
  const values = raw.map((o) => o.value).filter((v): v is string => !!v);
  const hasTpj = values.some((v) => v.startsWith('The Property Jungle'));
  const collapsed = values.filter((v) => !v.startsWith('The Property Jungle'));
  if (hasTpj) collapsed.push('TPJ');
  const deduped = Array.from(new Set(collapsed)).sort((a, b) => a.localeCompare(b));
  cache = { products: deduped, fetchedAt: Date.now() };
  return { products: deduped, cached: false, fetchedAt: cache.fetchedAt };
}

/** Resolve a collapsed display value back to the real Jira option value.
 *  'TPJ' has no matching option — callers must map it to a concrete
 *  'The Property Jungle …' variant, which this returns when unambiguous. */
export async function resolveProductOptionValue(
  client: JiraRestClient,
  display: string,
): Promise<string | null> {
  const raw = await client.getFieldOptions('customfield_13183');
  const values = raw.map((o) => o.value).filter((v): v is string => !!v);
  const exact = values.find((v) => v.toLowerCase() === display.toLowerCase());
  if (exact) return exact;
  if (display.toLowerCase() === 'tpj') {
    const tpj = values.filter((v) => v.startsWith('The Property Jungle'));
    return tpj.length === 1 ? tpj[0] : (tpj[0] ?? null);
  }
  return null;
}
