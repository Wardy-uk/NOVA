import { useState } from 'react';
import { GlassCard } from '../queue/index.js';

export interface ProposedResolutionCardProps {
  responseText?: string;
  editable?: boolean;
  onEdit?: (newText: string) => void;
}

export function ProposedResolutionCard({ responseText, editable, onEdit }: ProposedResolutionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(responseText ?? '');

  if (!responseText) return null;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">AI Proposed Resolution</div>
        {editable && (
          <button
            onClick={() => { setEditing(!editing); if (editing && editedText !== responseText) onEdit?.(editedText); }}
            className="text-[11px] text-[#5ec1ca] hover:underline"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 text-[13px] rounded-lg border border-[#5ec1ca]/30 text-neutral-200 bg-[#1a1e24] focus:outline-none focus:border-[#5ec1ca]/60"
        />
      ) : (
        <div className="text-[13px] text-neutral-300 whitespace-pre-wrap bg-[#1a1e24] rounded-lg px-4 py-3 border border-[#3a424d]">{responseText}</div>
      )}
    </GlassCard>
  );
}
