import { useState } from 'react';

interface DbEntry {
  id: number;
  onboarding_id: string | null;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  mrr: number | null;
  is_starred: number;
  sale_type: string | null;
}

interface Props {
  entries: DbEntry[];
  onStatusChange: (id: number, newStatus: string) => Promise<void>;
  onCardClick: (id: number) => void;
  onToggleStar: (id: number) => void;
  canWrite: boolean;
}

const KANBAN_COLUMNS = [
  { key: 'not-started', label: 'Not Started', statuses: ['Not Started', ''], color: '#6b7280' },
  { key: 'wip', label: 'WIP / In Progress', statuses: ['WIP', 'In Progress'], color: '#f59e0b' },
  { key: 'on-hold', label: 'On Hold', statuses: ['On Hold'], color: '#a855f7' },
  { key: 'complete', label: 'Complete', statuses: ['Complete'], color: '#22c55e' },
  { key: 'dead', label: 'Dead / Back to Sales', statuses: ['Dead', 'Back to Sales'], color: '#ef4444' },
];

function getColumnForStatus(status: string): string {
  const lower = (status || '').toLowerCase().trim();
  for (const col of KANBAN_COLUMNS) {
    if (col.statuses.some(s => s.toLowerCase() === lower)) return col.key;
  }
  return 'not-started';
}

function getPrimaryStatus(columnKey: string): string {
  const col = KANBAN_COLUMNS.find(c => c.key === columnKey);
  return col?.statuses[0] ?? 'Not Started';
}

export function DeliveryKanban({ entries, onStatusChange, onCardClick, onToggleStar, canWrite }: Props) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnKey);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDraggedId(null);
    if (!canWrite) return;
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(id)) return;
    const entry = entries.find(en => en.id === id);
    if (!entry) return;
    const currentCol = getColumnForStatus(entry.status);
    if (currentCol === columnKey) return;
    const newStatus = getPrimaryStatus(columnKey);
    await onStatusChange(id, newStatus);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverColumn(null);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
      {KANBAN_COLUMNS.map(col => {
        const columnEntries = entries.filter(e => getColumnForStatus(e.status) === col.key);
        const isOver = dragOverColumn === col.key;
        const totalMrr = columnEntries.reduce((s, e) => s + (e.mrr ?? 0), 0);

        return (
          <div
            key={col.key}
            className={`flex-shrink-0 w-64 rounded-lg border transition-colors ${
              isOver ? 'border-[#5ec1ca] bg-[#5ec1ca]/5' : 'border-[#3a424d] bg-[#2f353d]/50'
            }`}
            onDragOver={(e) => handleDragOver(e, col.key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.key)}
          >
            {/* Column header */}
            <div className="px-3 py-2.5 border-b border-[#3a424d] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
              <span className="text-xs font-semibold text-neutral-300">{col.label}</span>
              <span className="text-[10px] text-neutral-600 ml-auto">{columnEntries.length}</span>
            </div>
            {totalMrr > 0 && (
              <div className="px-3 py-1 text-[10px] text-neutral-500 border-b border-[#3a424d]/50">
                MRR: <span className="text-neutral-400">{'\u00A3'}{totalMrr.toLocaleString('en-GB')}</span>
              </div>
            )}

            {/* Cards */}
            <div className="p-2 space-y-2 min-h-[200px]">
              {columnEntries.map(entry => (
                <div
                  key={entry.id}
                  draggable={canWrite}
                  onDragStart={(e) => handleDragStart(e, entry.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onCardClick(entry.id)}
                  className={`bg-[#272C33] rounded border border-[#3a424d] p-2.5 transition-colors
                    hover:border-[#5ec1ca]/50 ${canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${
                    draggedId === entry.id ? 'opacity-40' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-[11px] text-neutral-200 font-medium leading-tight">{entry.account}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleStar(entry.id); }}
                      className={`text-xs shrink-0 ml-1 ${entry.is_starred ? 'text-amber-400' : 'text-neutral-600 hover:text-amber-400'}`}
                    >
                      {entry.is_starred ? '\u2605' : '\u2606'}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#5ec1ca]/10 text-[#5ec1ca]">{entry.product}</span>
                    {entry.onboarding_id && (
                      <span className="text-[8px] font-mono text-neutral-500">{entry.onboarding_id}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[10px] text-neutral-500">
                    {entry.onboarder && <span>{entry.onboarder}</span>}
                    {entry.mrr != null && entry.mrr > 0 && (
                      <span className="text-neutral-400 font-medium ml-auto">
                        {'\u00A3'}{entry.mrr.toLocaleString('en-GB')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {columnEntries.length === 0 && (
                <div className="text-[10px] text-neutral-600 text-center py-8">
                  {canWrite ? 'Drop here' : 'Empty'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
