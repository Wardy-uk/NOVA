import { useEffect, useState } from 'react';

/* 1-2-1 Setup — admin config for the 1-2-1 closed loop. Edits the configurable
   prep questions and email copy (settings keys one21_*). Lives in People → 1-2-1 Setup. */

const DEFAULT_QUESTIONS = [
  'What went well this month?',
  "What got in your way / what's blocking you?",
  'What do you want to focus on next month?',
  'Anything you want me to know, or any support you need from me?',
  'Looking at your KPIs this month, what are you most proud of?',
  'Looking at your KPIs this month, what do you most want to improve?',
  'How are you feeling about your role and workload right now?',
  'What progression are you working towards, and how can I support you in getting there?',
];

const C = {
  bg1: '#272C33', bg2: '#2f353d', border: '#3a424d',
  teal: '#5ec1ca', text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b', amber: '#d97706',
};

export function OneToOneSetupView() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [prepIntro, setPrepIntro] = useState('');
  const [mgrIntro, setMgrIntro] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // TEMPORARY test-send panel — remove once the email delivery question is settled.
  const [agents, setAgents] = useState<string[]>([]);
  const [testAgent, setTestAgent] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testKind, setTestKind] = useState<'prep' | 'receipt'>('prep');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const json = await res.json();
        const s = json.ok ? (json.data ?? json) : {};
        const raw = s.one21_prep_questions;
        let qs = DEFAULT_QUESTIONS;
        if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) qs = p.map(String); } catch { /* ignore */ } }
        setQuestions(qs);
        setPrepIntro(s.one21_prep_email_intro ?? '');
        setMgrIntro(s.one21_manager_summary_intro ?? '');
      } catch { setError('Could not load settings.'); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    fetch('/api/121/overview')
      .then((r) => r.json())
      .then((j) => {
        const names: string[] = j.ok ? (j.data?.agents ?? []).map((a: { agent_name: string }) => a.agent_name) : [];
        setAgents(names);
        setTestAgent((cur) => cur || names[0] || '');
      })
      .catch(() => { /* picker stays empty; the panel says so */ });
  }, []);

  const sendTest = async () => {
    if (!testAgent) return;
    setTesting(true); setTestMsg(null);
    try {
      const res = await fetch('/api/121/test-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: testKind, agentName: testAgent, to: testTo.trim() || undefined }),
      });
      const json = await res.json();
      setTestMsg(json.ok ? `Sent to ${json.data.to}.` : `Failed: ${json.error}`);
    } catch { setTestMsg('Failed: network error.'); }
    setTesting(false);
  };

  const putSetting = (key: string, value: string) =>
    fetch(`/api/settings/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });

  const save = async () => {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const cleaned = questions.map((q) => q.trim()).filter(Boolean);
      if (cleaned.length === 0) { setError('Add at least one question.'); setSaving(false); return; }
      await Promise.all([
        putSetting('one21_prep_questions', JSON.stringify(cleaned)),
        putSetting('one21_prep_email_intro', prepIntro.trim()),
        putSetting('one21_manager_summary_intro', mgrIntro.trim()),
      ]);
      setQuestions(cleaned);
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch { setError('Save failed.'); }
    setSaving(false);
  };

  const setQ = (i: number, v: string) => setQuestions((qs) => qs.map((q, k) => (k === i ? v : q)));
  const removeQ = (i: number) => setQuestions((qs) => qs.filter((_, k) => k !== i));
  const addQ = () => setQuestions((qs) => [...qs, '']);
  const move = (i: number, dir: -1 | 1) => setQuestions((qs) => {
    const j = i + dir;
    if (j < 0 || j >= qs.length) return qs;
    const next = [...qs]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>Loading…</div>;

  const input: React.CSSProperties = {
    width: '100%', background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '8px 10px', fontSize: 13, color: C.text1, fontFamily: 'inherit',
  };

  return (
    <div style={{ maxWidth: 760, padding: '4px 4px 40px' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text1, margin: 0 }}>1-2-1 Setup</h2>
        <p style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>
          The prep questions agents answer the day before, and the email intro copy. Changes apply to the next 1-2-1s scheduled.
        </p>
      </div>

      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text2, marginBottom: 12 }}>Prep questions</div>
        {questions.map((q, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: C.text3, width: 18, textAlign: 'right' }}>{i + 1}.</span>
            <input value={q} onChange={(e) => setQ(i, e.target.value)} style={{ ...input, flex: 1 }} />
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={iconBtn(i === 0)}>↑</button>
            <button onClick={() => move(i, 1)} disabled={i === questions.length - 1} title="Move down" style={iconBtn(i === questions.length - 1)}>↓</button>
            <button onClick={() => removeQ(i)} title="Remove" style={{ ...iconBtn(false), color: '#ef4444' }}>×</button>
          </div>
        ))}
        <button onClick={addQ} style={{ marginTop: 6, fontSize: 12, color: C.teal, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add question</button>
      </div>

      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text2, marginBottom: 12 }}>Email copy (optional)</div>
        <label style={{ fontSize: 12, color: C.text3, display: 'block', marginBottom: 4 }}>Agent prep email — intro line</label>
        <textarea value={prepIntro} onChange={(e) => setPrepIntro(e.target.value)} rows={2} placeholder="Leave blank to use the default wording." style={{ ...input, marginBottom: 14, resize: 'vertical' }} />
        <label style={{ fontSize: 12, color: C.text3, display: 'block', marginBottom: 4 }}>Manager summary email — intro line</label>
        <textarea value={mgrIntro} onChange={(e) => setMgrIntro(e.target.value)} rows={2} placeholder="Leave blank to use the default wording." style={{ ...input, resize: 'vertical' }} />
      </div>

      {/* TEMPORARY — fires the real email at one address so we can see where it lands. */}
      <div style={{ background: C.bg1, border: `1px dashed ${C.amber}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.amber, marginBottom: 4 }}>Test send (temporary)</div>
        <p style={{ fontSize: 12, color: C.text3, margin: '0 0 12px' }}>
          Sends the real email — that agent's live KPI numbers and the questions above — to you instead of them.
          Nothing is booked, no session changes, and the agent gets nothing. Subject is prefixed [TEST].
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={testKind} onChange={(e) => setTestKind(e.target.value as 'prep' | 'receipt')} style={{ ...input, width: 'auto' }}>
            <option value="prep">Prep request (day before)</option>
            <option value="receipt">Submission receipt</option>
          </select>
          <select value={testAgent} onChange={(e) => setTestAgent(e.target.value)} style={{ ...input, width: 'auto' }}>
            {agents.length === 0 && <option value="">No agents loaded</option>}
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send to (blank = you)" style={{ ...input, width: 220 }} />
          <button onClick={sendTest} disabled={testing || !testAgent} style={{
            padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.amber}`, background: 'transparent',
            color: C.amber, fontSize: 13, fontWeight: 700, cursor: testing || !testAgent ? 'default' : 'pointer',
            opacity: testing || !testAgent ? 0.5 : 1,
          }}>{testing ? 'Sending…' : 'Send test'}</button>
          {testMsg && <span style={{ fontSize: 12, color: testMsg.startsWith('Sent') ? '#10b981' : '#ef4444' }}>{testMsg}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={{
          padding: '9px 20px', borderRadius: 8, border: 'none', background: C.teal, color: C.bg1,
          fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : 'Save changes'}</button>
        {savedMsg && <span style={{ fontSize: 12, color: '#10b981' }}>{savedMsg}</span>}
        {error && <span style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>}
      </div>
    </div>
  );
}

const iconBtn = (disabled: boolean): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg2,
  color: disabled ? C.text3 : C.text2, cursor: disabled ? 'default' : 'pointer', fontSize: 13,
  opacity: disabled ? 0.4 : 1, flexShrink: 0,
});
