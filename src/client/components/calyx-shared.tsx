import { useState, useEffect, type CSSProperties } from 'react';
import type { TicketStatus, TicketPriority } from '../../shared/calyx-types.js';

export const C = {
  bg0: '#1e2228', bg1: '#272C33', bg2: '#2f353d', bg3: '#343a42',
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669',
  amber: '#d97706', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
  glassHover: 'rgba(255,255,255,0.06)',
} as const;

export const cardStyle: CSSProperties = {
  background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20,
};
export const selectStyle: CSSProperties = {
  background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '6px 10px', fontSize: 12, color: C.text1, outline: 'none', cursor: 'pointer', appearance: 'auto' as const,
};
export const inputStyle: CSSProperties = {
  width: '100%', background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '8px 12px', fontSize: 13, color: C.text1, outline: 'none', boxSizing: 'border-box',
};
export const btnPrimary: CSSProperties = {
  padding: '8px 18px', background: C.teal, color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
export const btnSecondary: CSSProperties = {
  padding: '8px 18px', background: 'transparent', color: C.teal, border: `1px solid ${C.teal}40`,
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
export const btnDanger: CSSProperties = {
  padding: '8px 18px', background: C.red, color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
export const labelStyle: CSSProperties = { display: 'block', fontSize: 11, color: C.text3, marginBottom: 4, fontWeight: 600 };

const STATUS_STYLE_MAP: Record<string, { color: string; bg: string }> = {
  open: { color: C.teal, bg: `${C.teal}18` },
  in_progress: { color: C.amber, bg: `${C.amber}18` },
  waiting_customer: { color: C.purple, bg: `${C.purple}18` },
  waiting_third_party: { color: C.purple, bg: `${C.purple}18` },
  resolved: { color: C.green, bg: `${C.green}18` },
  closed: { color: C.text3, bg: `${C.text3}15` },
  // problem statuses
  identified: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  in_analysis: { color: C.amber, bg: `${C.amber}18` },
  known_error: { color: C.red, bg: `${C.red}18` },
  // change statuses
  draft: { color: C.text3, bg: `${C.text3}15` },
  submitted: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  approved: { color: C.teal, bg: `${C.teal}18` },
  rejected: { color: C.red, bg: `${C.red}18` },
  implementing: { color: C.amber, bg: `${C.amber}18` },
  complete: { color: C.green, bg: `${C.green}18` },
  cancelled: { color: C.text3, bg: `${C.text3}10` },
  // improvement statuses
  proposed: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  // source badges
  problem: { color: C.teal, bg: `${C.teal}18` },
  pir: { color: C.purple, bg: `${C.purple}18` },
  csat: { color: C.amber, bg: `${C.amber}18` },
  manual: { color: C.text3, bg: `${C.text3}15` },
  audit: { color: C.red, bg: `${C.red}18` },
  // change types
  normal: { color: C.text2, bg: `${C.text3}15` },
  standard: { color: C.teal, bg: `${C.teal}18` },
  emergency: { color: C.red, bg: `${C.red}18` },
  // risk levels
  low: { color: C.green, bg: `${C.green}18` },
  medium: { color: C.amber, bg: `${C.amber}18` },
  high: { color: C.red, bg: `${C.red}18` },
  critical: { color: '#dc2626', bg: 'rgba(220,38,38,0.18)' },
  // kb statuses
  published: { color: C.green, bg: `${C.green}18` },
  archived: { color: C.text3, bg: `${C.text3}15` },
};

const PRIORITY_COLORS: Record<string, string> = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P4: '#64748b' };

export function ReferenceTag({ ref: r }: { ref: string }) {
  return <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.teal, fontWeight: 600 }}>{r}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE_MAP[status] || { color: C.text3, bg: `${C.text3}15` };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      color: s.color, background: s.bg, border: `1px solid ${s.color}40`, whiteSpace: 'nowrap',
    }}>{status.replace(/_/g, ' ')}</span>
  );
}

export function PriorityBadge({ priority, glow }: { priority: string; glow?: boolean }) {
  const color = PRIORITY_COLORS[priority] || C.text3;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
      color: '#fff', background: `${color}cc`, border: `1px solid ${color}60`,
      boxShadow: glow ? `0 0 10px ${color}40` : 'none',
    }}>{priority}</span>
  );
}

export function SlaCountdown({ dueAt, isPaused, metAt, isFrt }: { dueAt: string | null; isPaused?: boolean; metAt?: string | null; isFrt?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  if ((isFrt && metAt) || (!isFrt && metAt)) return <span style={{ color: C.green, fontWeight: 600, fontSize: 12 }}>Met</span>;
  if (!dueAt) return <span style={{ color: C.text3, fontSize: 12 }}>--</span>;
  if (isPaused) return <span style={{ color: C.purple, fontSize: 12 }}>Paused</span>;

  const due = new Date(dueAt.replace(' ', 'T') + (dueAt.includes('Z') || dueAt.includes('+') ? '' : 'Z')).getTime();
  const diff = due - now;
  if (diff <= 0) {
    const m = Math.floor(Math.abs(diff) / 60000);
    return <span style={{ color: C.red, fontWeight: 600, fontSize: 12 }}>{m < 60 ? `-${m}m` : `-${Math.floor(m / 60)}h ${m % 60}m`}</span>;
  }
  const m = Math.floor(diff / 60000);
  const color = m < 30 ? C.red : m < 120 ? C.amber : C.green;
  return <span style={{ color, fontWeight: 600, fontSize: 12 }}>{m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}</span>;
}

export function SloProgress({ targetAt, warningAt, completedAt, breached }: { targetAt: string; warningAt?: string; completedAt?: string | null; breached?: boolean }) {
  if (completedAt) return <div style={{ height: 4, borderRadius: 2, background: C.green, width: '100%' }} />;
  if (breached) return <div style={{ height: 4, borderRadius: 2, background: C.red, width: '100%' }} />;
  const now = Date.now();
  const target = new Date(targetAt).getTime();
  const warn = warningAt ? new Date(warningAt).getTime() : target * 0.8;
  const total = target - (target - (target - now) - (target - now)); // simplify
  const remaining = Math.max(0, target - now);
  const pct = Math.min(100, Math.max(0, (1 - remaining / Math.max(1, target - (target - 3600000))) * 100));
  const color = now >= target ? C.red : now >= warn ? C.amber : C.teal;
  return (
    <div style={{ height: 4, borderRadius: 2, background: `${C.text3}20`, width: '100%' }}>
      <div style={{ height: 4, borderRadius: 2, background: color, width: `${Math.min(pct, 100)}%`, transition: 'width 0.5s' }} />
    </div>
  );
}

export function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: `${C.teal}25`, border: `1px solid ${C.teal}40`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: C.teal, flexShrink: 0,
    }}>{initials}</div>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  const icons: Record<string, string> = { inbox: '\u{1F4E5}', check: '\u2705', search: '\u{1F50D}', chart: '\u{1F4CA}' };
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icons[icon || 'inbox'] || '\u{1F4E5}'}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.text1, marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: C.text3 }}>{subtitle}</div>}
    </div>
  );
}

export function ragColor(value: number, target: number, isHigherBetter: boolean): string {
  if (isHigherBetter) {
    if (value >= target) return C.green;
    if (value >= target * 0.85) return C.amber;
    return C.red;
  }
  if (value <= target) return C.green;
  if (value <= target * 1.15) return C.amber;
  return C.red;
}

export function formatDate(d: string): string {
  return new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') ? '' : 'Z'))
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d: string): string {
  return new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') ? '' : 'Z'))
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function calyxApi<T = any>(path: string, opts?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = localStorage.getItem('nova_token');
  const res = await fetch(`/api/calyx${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  return res.json();
}

export function useCalyxData<T>(path: string, deps: any[] = []): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); calyxApi<T>(path).then(r => { if (r.ok && r.data !== undefined) setData(r.data); setLoading(false); }); };
  useEffect(() => { load(); }, deps);
  return { data, loading, reload: load };
}

export function SlidePanel({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width, maxWidth: '90vw', background: C.bg0,
        borderLeft: `1px solid ${C.border}`, zIndex: 1000, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ margin: 0, fontSize: 16, color: C.text1 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 18 }}>&times;</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>{children}</div>
      </div>
    </>
  );
}
