import { useState, useMemo, useEffect, useCallback } from 'react';

interface SaleType {
  id: number;
  name: string;
  sort_order: number;
  active: number;
}

interface MilestoneTemplate {
  id: number;
  name: string;
  day_offset: number;
  sort_order: number;
  active: number;
}

interface MatrixOffset {
  sale_type_id: number;
  template_id: number;
  day_offset: number;
}

export function OnboardingCalendar() {
  const [saleTypes, setSaleTypes] = useState<SaleType[]>([]);
  const [templates, setTemplates] = useState<MilestoneTemplate[]>([]);
  const [offsets, setOffsets] = useState<MatrixOffset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [stRes, tmplRes, matrixRes] = await Promise.all([
        fetch('/api/onboarding/config/sale-types'),
        fetch('/api/milestones/templates?active=1'),
        fetch('/api/milestones/matrix'),
      ]);
      const [stJson, tmplJson, matrixJson] = await Promise.all([
        stRes.json(), tmplRes.json(), matrixRes.json(),
      ]);
      if (stJson.ok) setSaleTypes(stJson.data);
      if (tmplJson.ok) setTemplates(tmplJson.data);
      if (matrixJson.ok) setOffsets(matrixJson.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.sort_order - b.sort_order || a.day_offset - b.day_offset),
    [templates],
  );

  // Sale types that have rows in the matrix
  const matrixSaleTypeIds = useMemo(() => new Set(offsets.map(o => o.sale_type_id)), [offsets]);
  const matrixSaleTypes = useMemo(
    () => saleTypes.filter(st => matrixSaleTypeIds.has(st.id) && st.active).sort((a, b) => a.sort_order - b.sort_order),
    [saleTypes, matrixSaleTypeIds],
  );

  const getValue = (saleTypeId: number, templateId: number): number | null => {
    const offset = offsets.find(o => o.sale_type_id === saleTypeId && o.template_id === templateId);
    return offset ? offset.day_offset : null;
  };

  if (loading) {
    return <div className="text-center py-16 text-sm text-neutral-500">Loading milestone matrix...</div>;
  }

  if (sortedTemplates.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-neutral-500">
        No milestone templates configured. Set up templates in Admin &rarr; Milestones.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
            Milestone Timelines
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Day offsets from order date by sale type. Edit in Admin &rarr; Milestones.
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          {matrixSaleTypes.length} sale type{matrixSaleTypes.length !== 1 ? 's' : ''} &middot; {sortedTemplates.length} milestones
        </div>
      </div>

      {matrixSaleTypes.length === 0 ? (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-8 text-center text-sm text-neutral-500">
          No sale types configured in the milestone matrix yet. Add them in Admin &rarr; Milestones.
        </div>
      ) : (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-auto max-h-[70vh]">
          <table className="text-[11px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#2f353d]">
                <th className="sticky left-0 z-20 bg-[#2f353d] text-left px-2 py-1.5 text-neutral-500 min-w-[160px] border-b border-r border-[#3a424d]">
                  Sale Type
                </th>
                {sortedTemplates.map((tmpl, idx) => {
                  const groupColors = [
                    'bg-purple-900/20 border-purple-800/30',
                    'bg-blue-900/20 border-blue-800/30',
                    'bg-teal-900/20 border-teal-800/30',
                    'bg-indigo-900/20 border-indigo-800/30',
                    'bg-cyan-900/20 border-cyan-800/30',
                    'bg-violet-900/20 border-violet-800/30',
                  ];
                  return (
                    <th
                      key={tmpl.id}
                      className={`px-2 py-1.5 text-purple-300 font-semibold border-b border-x border-[#3a424d] min-w-[80px] text-center ${groupColors[idx % groupColors.length]}`}
                      title={`${tmpl.name} (default: Day ${tmpl.day_offset})`}
                    >
                      <div className="leading-tight">{tmpl.name}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrixSaleTypes.map(st => (
                <tr key={st.id} className="hover:bg-[#363d47]/50">
                  <td className="sticky left-0 bg-[#2f353d] px-2 py-1 text-neutral-200 border-r border-[#3a424d] whitespace-nowrap">
                    {st.name}
                  </td>
                  {sortedTemplates.map(tmpl => {
                    const val = getValue(st.id, tmpl.id);
                    const displayVal = val ?? tmpl.day_offset;
                    return (
                      <td key={tmpl.id} className="text-center border border-[#3a424d]/30 bg-[#5ec1ca]/20">
                        <span className="font-mono text-xs text-[#5ec1ca]">
                          {displayVal}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
