import { useState } from 'react';
import { KpiDataView } from './KpiDataView.js';
import { KpiComparisonView } from './KpiComparisonView.js';

type SubTab = 'data' | 'compare';

export function ServiceDeskKpis() {
  const [subTab, setSubTab] = useState<SubTab>('data');

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-2">
        {([['data', 'KPI Data'], ['compare', 'Live vs UAT']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-4 py-1.5 text-xs rounded-lg transition-colors ${
              subTab === key
                ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] font-semibold border border-[#5ec1ca]/30'
                : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200 border border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'data' && <KpiDataView />}
      {subTab === 'compare' && <KpiComparisonView />}
    </div>
  );
}
