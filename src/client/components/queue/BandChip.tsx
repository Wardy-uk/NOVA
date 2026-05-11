const BAND_STYLES: Record<string, { bg: string; fg: string }> = {
  NOW: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
  NEXT: { bg: 'rgba(94,193,202,0.15)', fg: '#5ec1ca' },
  DEFERRED: { bg: 'rgba(155,106,237,0.15)', fg: '#9b6aed' },
  HYGIENE: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  WAITING: { bg: 'rgba(100,116,139,0.15)', fg: '#64748b' },
};

export function BandChip({ band }: { band: string }) {
  const m = BAND_STYLES[band] ?? BAND_STYLES.WAITING;
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: m.bg, color: m.fg, border: `1px solid ${m.fg}40` }}
    >
      {band}
    </span>
  );
}
