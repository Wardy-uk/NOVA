const STATUS_CATEGORY_MAP: Record<string, string> = { new: 'Open', indeterminate: 'In Progress', done: 'Done' };

export function resolveStatusName(statusField: unknown): string | null {
  if (!statusField || typeof statusField !== 'object') return null;
  const s = statusField as Record<string, unknown>;
  const name = typeof s.name === 'string' ? s.name : null;

  if (name && /^[\x20-\x7E]+$/.test(name)) return name;

  const cat = s.statusCategory as Record<string, unknown> | undefined;
  if (cat) {
    const catName = typeof cat.name === 'string' ? cat.name : null;
    if (catName && /^[\x20-\x7E]+$/.test(catName)) return catName;
    const catKey = typeof cat.key === 'string' ? cat.key : null;
    if (catKey) return STATUS_CATEGORY_MAP[catKey] ?? catKey;
  }

  return name;
}

export function resolveStatusFromCache(statusName: string | null, statusCategory: string | null): string {
  if (statusName && /^[\x20-\x7E]+$/.test(statusName)) return statusName;
  if (statusCategory) return STATUS_CATEGORY_MAP[statusCategory] ?? statusCategory;
  return statusName ?? 'Unknown';
}
