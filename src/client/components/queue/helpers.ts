export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '—';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export function timeRemaining(expiresAt: string): { text: string; urgency: 'normal' | 'warning' | 'critical' | 'expired' } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (isNaN(diff)) return { text: '—', urgency: 'normal' };
  if (diff <= 0) return { text: 'Expired', urgency: 'expired' };
  const mins = Math.floor(diff / 60000);
  if (mins < 10) return { text: `${mins}m`, urgency: 'critical' };
  if (mins < 30) return { text: `${mins}m`, urgency: 'warning' };
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return { text: `${hrs}h ${remMins}m`, urgency: 'normal' };
}

export const URGENCY_COLORS: Record<string, string> = {
  normal: 'text-neutral-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
  expired: 'text-neutral-600',
};

export function riskScoreColor(score: number): string {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f59e0b';
  return '#fbbf24';
}

export function commentBodyToText(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  try {
    const walk = (node: any): string => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(walk).join('');
      return '';
    };
    return walk(body);
  } catch { return ''; }
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function getDefaultCommentType(transitionName: string): 'public' | 'internal' {
  const CUSTOMER_FACING = ['waiting on requestor', 'waiting on partner'];
  return CUSTOMER_FACING.includes(transitionName.toLowerCase()) ? 'public' : 'internal';
}
