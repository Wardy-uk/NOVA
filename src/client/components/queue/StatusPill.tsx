const STATUS_STYLES: Array<{ match: (s: string) => boolean; bg: string; fg: string }> = [
  { match: s => s.includes('progress'), bg: 'rgba(94,193,202,0.15)', fg: '#5ec1ca' },
  { match: s => s.includes('waiting'), bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  { match: s => s.includes('resolved') || s.includes('closed') || s.includes('done'), bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
  { match: s => s.includes('open') || s.includes('new'), bg: 'rgba(155,106,237,0.15)', fg: '#9b6aed' },
  { match: s => s.includes('pending'), bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  { match: s => s.includes('review'), bg: 'rgba(94,193,202,0.15)', fg: '#5ec1ca' },
  { match: s => s.includes('accepted'), bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
  { match: s => s.includes('returned'), bg: 'rgba(155,106,237,0.15)', fg: '#9b6aed' },
  { match: s => s.includes('archived'), bg: 'rgba(100,116,139,0.15)', fg: '#64748b' },
  { match: s => s.includes('declined') || s.includes('cancel'), bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
  { match: s => s.includes('approved'), bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
  { match: s => s.includes('expired') || s.includes('timed'), bg: 'rgba(100,116,139,0.15)', fg: '#64748b' },
];

export function StatusPill({ status, label }: { status: string | null | undefined; label?: string }) {
  const s = (status ?? '').toLowerCase();
  const display = label ?? status ?? 'Unknown';
  const match = STATUS_STYLES.find(m => m.match(s));
  const bg = match?.bg ?? 'rgba(100,116,139,0.15)';
  const fg = match?.fg ?? '#64748b';

  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color: fg, border: `1px solid ${fg}40` }}
    >
      {display}
    </span>
  );
}
