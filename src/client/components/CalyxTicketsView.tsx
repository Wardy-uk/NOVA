import { useState } from 'react';
import { CalyxProblemsView } from './CalyxProblemsView.js';
import { CalyxChangesView } from './CalyxChangesView.js';
import { CalyxMajorIncidentsView } from './CalyxMajorIncidentsView.js';

const C = {
  bg1: '#272C33',
  bg2: '#2f353d',
  teal: '#5ec1ca',
  text1: '#e2e8f0',
  text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
} as const;

type SubView = 'problems' | 'changes' | 'major-incidents';

const SUB_TABS: { view: SubView; label: string }[] = [
  { view: 'problems', label: 'Problems' },
  { view: 'changes', label: 'Changes' },
  { view: 'major-incidents', label: 'Major Incidents' },
];

export function CalyxTicketsView() {
  const [active, setActive] = useState<SubView>('problems');

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
        {SUB_TABS.map(t => (
          <button key={t.view} onClick={() => setActive(t.view)} style={{
            padding: '10px 18px', fontSize: 13, fontWeight: active === t.view ? 700 : 500,
            cursor: 'pointer', background: 'none', border: 'none',
            color: active === t.view ? C.teal : C.text3,
            borderBottom: active === t.view ? `2px solid ${C.teal}` : '2px solid transparent',
            transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>
      {active === 'problems' && <CalyxProblemsView />}
      {active === 'changes' && <CalyxChangesView />}
      {active === 'major-incidents' && <CalyxMajorIncidentsView />}
    </div>
  );
}
