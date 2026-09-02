import { useEffect } from 'react';

/* Return to Work — a guided prompt sheet for the conversation a manager has when
   someone comes back from sickness absence. Mirrors Nurtur's HR "Return to Work
   Interview" form section for section.

   Deliberately READ-ONLY: no fields, no saving, one screen. The record of the
   conversation lives on the HR form and in PeopleHR, and a half-filled duplicate in
   NOVA would compete with it. This is the script, not the record. */

const C = {
  bg1: '#272C33', bg2: '#2f353d', glass: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.08)',
  teal: '#5ec1ca', amber: '#d97706', text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
};

interface Section {
  title: string;
  note?: string;
  prompts: Array<{ ask: string; hint?: string }>;
}

const SECTIONS: Section[] = [
  {
    title: 'Before you start',
    note: 'Complete this for every sickness absence, however short.',
    prompts: [
      { ask: 'Confirm the first day of absence and the last day of absence.' },
      { ask: 'Confirm today’s date as the date of the meeting.' },
      { ask: 'Say why you are having the conversation — welcome back, check they are well, agree anything they need.', hint: 'Set the tone: this is a supportive check-in, not a disciplinary.' },
    ],
  },
  {
    title: 'Reason for absence',
    prompts: [
      { ask: 'What was the reason for the absence?' },
      { ask: 'Are you confirming you are fit to return to work?' },
      { ask: 'Has the GP made any suggestions in a Fit Note?', hint: 'Only applies to absences over 7 days — ask for the note if there is one.' },
      { ask: 'Do you consider that you have an underlying health issue?' },
      { ask: 'If yes — how does it affect your work and your day-to-day activities?' },
      { ask: 'If there is an impact — what reasonable adjustments would help?', hint: 'Suggest as well as ask. Anything agreed here needs following up, not just noting.' },
    ],
  },
  {
    title: 'Absence reporting',
    prompts: [
      { ask: 'Was the correct reporting procedure followed?' },
      { ask: 'If not — where did it fall short?', hint: 'Remind them of the process: phone the line manager before the start of shift, not a text.' },
      { ask: 'Confirm what will happen next if the process is not followed again.' },
    ],
  },
  {
    title: 'Review of absence record',
    note: 'Check PeopleHR before the meeting so you can talk to the actual numbers.',
    prompts: [
      { ask: 'How many days or separate periods of absence in the last 12 months?' },
      { ask: 'Is there a regular pattern of absence?', hint: 'Mondays, Fridays, days either side of leave, the same week each month.' },
      { ask: 'Have they reached any trigger points for review?' },
      { ask: 'Is there a recurring problem behind the absences?' },
      { ask: 'Any other issues they want to raise?' },
    ],
  },
  {
    title: 'Agreements and next steps',
    prompts: [
      { ask: 'Summarise what has been agreed, out loud, so you both leave with the same understanding.' },
      { ask: 'Agree who does what, and by when.' },
      { ask: 'Agree whether a follow-up conversation is needed, and when.' },
    ],
  },
  {
    title: 'Close out',
    note: 'The conversation is not finished until these are done.',
    prompts: [
      { ask: 'Both sign the Return to Work form — employee and line manager.' },
      { ask: 'Confirm the employee understands the information is used to record and monitor sickness absence.' },
      { ask: 'Log the absence on PeopleHR (Absence Recording and Monitoring).' },
    ],
  },
];

export function ReturnToWorkModal({ agentName, onClose }: { agentName: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 14,
          width: 'min(760px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text1 }}>Return to Work — {agentName}</div>
            <div style={{ fontSize: 11.5, color: C.text3, marginTop: 3 }}>
              Prompts for the conversation. Nothing is recorded here — the record is the HR form and PeopleHR.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text2, cursor: 'pointer', fontSize: 14, width: 30, height: 30, flexShrink: 0 }}
            title="Close (Esc)"
          >×</button>
        </div>

        <div style={{ padding: '14px 20px 20px', overflowY: 'auto' }}>
          {SECTIONS.map((s) => (
            <div key={s.title} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, textTransform: 'uppercase', letterSpacing: 0.6 }}>{s.title}</div>
              {s.note && <div style={{ fontSize: 11.5, color: C.text3, marginTop: 3, fontStyle: 'italic' }}>{s.note}</div>}
              <div style={{ marginTop: 8 }}>
                {s.prompts.map((p) => (
                  <div key={p.ask} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 11px', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, color: C.text1, lineHeight: 1.45 }}>{p.ask}</div>
                    {p.hint && <div style={{ fontSize: 11.5, color: C.text3, marginTop: 4, lineHeight: 1.4 }}>{p.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ fontSize: 11.5, color: C.amber, background: `${C.amber}12`, border: `1px solid ${C.amber}40`, borderRadius: 8, padding: '9px 12px' }}>
            If the conversation turns to capability, a long-term condition or anything they want kept
            confidential, stop and involve HR before agreeing anything.
          </div>
        </div>
      </div>
    </div>
  );
}
