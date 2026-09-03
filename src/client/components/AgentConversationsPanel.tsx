import { useEffect, useState } from 'react';

/* Every individual conversation on one person's record — 1-2-1s, return-to-work
   interviews, performance and welfare conversations, ad-hoc chats — newest first.

   Reads ONE endpoint over two tables. 1-2-1s live in `agent_121_sessions` because they
   drive the cadence; everything else lives in `agent_conversations` because it must not —
   a welfare check on Tuesday does not discharge the monthly 1-2-1. But "who have I sat
   down with, and when" is a single question, so the server merges them and `kind` says
   which table a row came from. That field is also what picks the right PeopleHR route. */

const C = {
  bg1: '#272C33', bg2: '#2f353d', glass: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)',
  teal: '#5ec1ca', green: '#10b981', amber: '#f59e0b', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
};

export interface ConversationRecord {
  kind: 'session' | 'conversation';
  id: number;
  agentName: string;
  conversationType: string;
  typeLabel: string;
  occurredOn: string;
  startedAt: string | null;
  title: string | null;
  summaryExcerpt: string | null;
  hasTranscript: boolean;
  peoplehrLogged: boolean;
  peoplehrLoggedAt: string | null;
}

/* Plaud's API returns UTC with no marker on it, so the naked string must be read as UTC
   and rendered for London — otherwise every summer conversation shows an hour early and
   every winter one looks fine. Same rule as the 1-2-1 overview. */
const LONDON_HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
});
const startTime = (s: string | null): string | null => {
  const raw = String(s ?? '').trim();
  if (!raw) return null;
  const t = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(t.getTime()) ? null : LONDON_HHMM.format(t);
};

const longDate = (s: string) =>
  new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const TYPE_COLOR: Record<string, string> = {
  one_to_one: C.teal,
  return_to_work: C.amber,
  performance: '#a78bfa',
  welfare: C.green,
  ad_hoc: C.text3,
};

export function AgentConversationsPanel({ agentName }: { agentName: string }) {
  const [rows, setRows] = useState<ConversationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const load = () => {
    fetch(`/api/121/agent/${encodeURIComponent(agentName)}/conversations`)
      .then((r) => r.json())
      .then((j) => { if (j.ok) setRows(j.data); else setError(j.error || 'Could not load conversations.'); })
      .catch(() => setError('Could not load conversations.'));
  };
  useEffect(() => { if (agentName) load(); }, [agentName]);

  /* Optimistic, so ticking several in a row feels like ticking a list rather than
     operating a form. Reverted on failure: this is a record of what Nick has actually
     done in PeopleHR, so a tick NOVA did not save is worse than a moment's delay. */
  const toggleHr = async (row: ConversationRecord, logged: boolean) => {
    const key = `${row.kind}:${row.id}`;
    setSaving(key);
    setRows((prev) => prev && prev.map((r) =>
      (r.kind === row.kind && r.id === row.id) ? { ...r, peoplehrLogged: logged } : r));
    try {
      const path = row.kind === 'session' ? 'session' : 'conversation';
      const res = await fetch(`/api/121/${path}/${row.id}/peoplehr`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logged }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      load();
    }
    setSaving(null);
  };

  if (error) return <div style={{ fontSize: 12, color: C.text3, padding: 12 }}>{error}</div>;
  if (!rows) return <div style={{ fontSize: 12, color: C.text3, padding: 12 }}>Loading conversations…</div>;

  const types = [...new Set(rows.map((r) => r.conversationType))];
  const shown = filter === 'all' ? rows : rows.filter((r) => r.conversationType === filter);
  const toLog = rows.filter((r) => !r.peoplehrLogged).length;

  return (
    <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>Conversations</div>
        <div style={{ fontSize: 11, color: C.text3 }}>
          {rows.length} on record
          {toLog > 0 && <span style={{ color: C.amber }}> · {toLog} to log in PeopleHR</span>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>
        Every one-to-one conversation, not just the 1-2-1s. The PeopleHR tick is your own —
        NOVA cannot see PeopleHR and never assumes a write-up exists.
      </div>

      {types.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {['all', ...types].map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              style={{
                padding: '3px 9px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${filter === t ? C.teal : C.border}`,
                background: filter === t ? `${C.teal}20` : 'transparent',
                color: filter === t ? C.teal : C.text3,
              }}
            >{t === 'all' ? 'All' : (rows.find((r) => r.conversationType === t)?.typeLabel ?? t)}</button>
          ))}
        </div>
      )}

      {shown.length === 0 && (
        <div style={{ fontSize: 12, color: C.text3, padding: '10px 0' }}>
          {/* Silence said out loud: an empty panel here would read as "no conversations
              happened" when it usually means none have been approved onto the record yet. */}
          Nothing on record yet. Recordings appear here once you approve them on the 1-2-1 Overview.
        </div>
      )}

      {shown.map((r) => (
        <div
          key={`${r.kind}:${r.id}`}
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            background: C.glass, border: `1px solid ${C.border}`, borderRadius: 9,
            padding: '9px 11px', marginBottom: 7,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                color: TYPE_COLOR[r.conversationType] ?? C.text3,
                border: `1px solid ${TYPE_COLOR[r.conversationType] ?? C.text3}55`,
                borderRadius: 4, padding: '1px 6px',
              }}>{r.typeLabel}</span>
              <span style={{ fontSize: 12.5, color: C.text1, fontWeight: 600 }}>{longDate(r.occurredOn)}</span>
              {startTime(r.startedAt) && <span style={{ fontSize: 11, color: C.text3 }}>{startTime(r.startedAt)}</span>}
              {!r.hasTranscript && (
                <span style={{ fontSize: 10.5, color: C.text3 }} title="No transcript — the date is recorded but nothing can be read back">
                  no transcript
                </span>
              )}
            </div>
            {r.title && (
              <div style={{ fontSize: 11.5, color: C.text2, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title}
              </div>
            )}
            {r.summaryExcerpt && (
              <details style={{ marginTop: 5 }}>
                <summary style={{ fontSize: 11, color: C.teal, cursor: 'pointer' }}>What was discussed</summary>
                <div style={{
                  fontSize: 11.5, color: C.text2, marginTop: 5, whiteSpace: 'pre-wrap',
                  maxHeight: 220, overflowY: 'auto', paddingRight: 6, lineHeight: 1.5,
                }}>{r.summaryExcerpt}</div>
              </details>
            )}
          </div>
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}
            title={r.peoplehrLogged
              ? `Logged in PeopleHR${r.peoplehrLoggedAt ? ` on ${r.peoplehrLoggedAt.slice(0, 10)}` : ''} — click to undo`
              : 'Tick once this conversation is written up in PeopleHR'}
          >
            <input
              type="checkbox"
              checked={r.peoplehrLogged}
              disabled={saving === `${r.kind}:${r.id}`}
              onChange={(e) => toggleHr(r, e.target.checked)}
              style={{ accentColor: C.teal, cursor: 'pointer', width: 15, height: 15 }}
            />
            <span style={{ fontSize: 10.5, color: r.peoplehrLogged ? C.text3 : C.amber }}>
              {r.peoplehrLogged ? 'Logged' : 'To log'}
            </span>
          </label>
        </div>
      ))}
    </div>
  );
}
