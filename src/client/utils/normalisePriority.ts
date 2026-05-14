const PRIORITY_NORMALIZE: Record<string, string> = {
  '最高': 'Highest', '高': 'High', '中': 'Medium', '低': 'Low', '最低': 'Lowest',
  '高い': 'High', '低い': 'Low',
  '최고': 'Highest', '높음': 'High', '중간': 'Medium', '낮음': 'Low', '최저': 'Lowest',
};

export function normalisePriority(raw: string | null | undefined): string {
  if (!raw) return 'Normal';
  return PRIORITY_NORMALIZE[raw] ?? raw;
}
