const SYNONYM_GROUPS: string[][] = [
  ['website', 'site', 'webpage', 'homepage'],
  ['login', 'signin', 'password', 'logon'],
  ['email', 'mail', 'newsletter', 'campaign', 'mailshot'],
  ['slow', 'performance', 'loading', 'speed', 'timeout'],
  ['broken', 'error', 'fault', 'failing', 'crash', 'bug'],
  ['portal', 'valuation'],
  ['crm', 'leadpro', 'contacts'],
  ['down', 'offline', 'unavailable', 'outage', 'downtime'],
  ['update', 'change', 'edit', 'modify', 'amend'],
  ['delete', 'remove', 'cancel', 'deactivate'],
  ['setup', 'onboarding', 'configure', 'install'],
  ['image', 'photo', 'picture', 'logo', 'banner'],
  ['domain', 'dns', 'url', 'hosting'],
  ['template', 'layout', 'design', 'theme'],
  ['property', 'listing', 'branch', 'office'],
  ['report', 'stats', 'analytics', 'dashboard'],
  ['user', 'account', 'profile', 'member'],
  ['notification', 'alert', 'reminder'],
];

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'how', 'who',
  'did', 'get', 'got', 'him', 'his', 'its', 'may', 'new', 'now', 'old',
  'see', 'way', 'may', 'with', 'this', 'that', 'from', 'they', 'been',
  'what', 'when', 'will', 'more', 'some', 'than', 'them', 'then', 'into',
  'just', 'also', 'about', 'would', 'there', 'their', 'which', 'could',
  'other', 'after', 'being', 'those', 'where', 'these', 'does', 'doing',
  'want', 'need', 'help', 'please', 'thanks', 'work', 'working',
]);

export function expandSearchTerms(rawTerms: string[]): string[] {
  const expanded = new Set<string>();
  const original: string[] = [];

  for (const t of rawTerms) {
    const lower = t.toLowerCase();
    if (lower.length < 3 || STOP_WORDS.has(lower)) continue;
    original.push(lower);
    expanded.add(lower);
  }

  for (const term of original) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(term)) {
        for (const synonym of group) {
          expanded.add(synonym);
        }
        break;
      }
    }
  }

  return [...expanded];
}

export function cleanSearchTerms(rawTerms: string[]): string[] {
  return rawTerms
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

export interface ScoredResult<T> {
  item: T;
  score: number;
}

export function scoreKbResult(
  title: string,
  bodyText: string,
  originalTerms: string[],
  expandedTerms: string[],
): number {
  const titleLower = title.toLowerCase();
  const bodyLower = (bodyText || '').toLowerCase();

  let score = 0;
  let originalTitleHits = 0;
  let originalBodyHits = 0;

  for (const term of originalTerms) {
    if (titleLower.includes(term)) {
      originalTitleHits++;
      score += 5;
    }
    if (bodyLower.includes(term)) {
      originalBodyHits++;
      score += 1;
    }
  }

  for (const term of expandedTerms) {
    if (originalTerms.includes(term)) continue;
    if (titleLower.includes(term)) score += 2;
    if (bodyLower.includes(term)) score += 0.5;
  }

  const phrase = originalTerms.join(' ');
  if (phrase.length > 5 && titleLower.includes(phrase)) {
    score += 8;
  }

  if (originalTerms.length > 1 && originalTitleHits >= originalTerms.length) {
    score += 3;
  }

  if (originalTerms.length > 1 && (originalTitleHits + originalBodyHits) >= originalTerms.length) {
    score += 1;
  }

  return score;
}

export function meetsRelevanceThreshold(score: number, termCount: number): boolean {
  if (termCount <= 1) return score >= 1;
  return score >= 2;
}

export function rankAndFilter<T>(
  items: T[],
  getTitle: (item: T) => string,
  getBody: (item: T) => string,
  originalTerms: string[],
  expandedTerms: string[],
  limit: number,
): ScoredResult<T>[] {
  const scored = items.map(item => ({
    item,
    score: scoreKbResult(getTitle(item), getBody(item), originalTerms, expandedTerms),
  }));

  return scored
    .filter(s => meetsRelevanceThreshold(s.score, originalTerms.length))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
