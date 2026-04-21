import { useState } from 'react';
import { CalyxSloSettingsView } from './CalyxSloSettingsView.js';
import { CalyxBusinessHoursView } from './CalyxBusinessHoursView.js';
import { CalyxOrganisationsView } from './CalyxOrganisationsView.js';

const C = {
  teal: '#5ec1ca',
  text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
} as const;

type SubView = 'slo-settings' | 'business-hours' | 'organisations';

const SUB_TABS: { view: SubView; label: string }[] = [
  { view: 'slo-settings', label: 'SLO Settings' },
  { view: 'business-hours', label: 'Business Hours' },
  { view: 'organisations', label: 'Organisations' },
];

export function CalyxSettingsView() {
  const [active, setActive] = useState<SubView>('slo-settings');

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
      {active === 'slo-settings' && <CalyxSloSettingsView />}
      {active === 'business-hours' && <CalyxBusinessHoursView />}
      {active === 'organisations' && <CalyxOrganisationsView />}
    </div>
  );
}
