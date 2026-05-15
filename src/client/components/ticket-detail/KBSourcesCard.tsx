import { GlassCard } from '../queue/index.js';

export interface KBSourcesCardProps {
  sources?: Array<{ title: string; url: string }>;
}

export function KBSourcesCard({ sources }: KBSourcesCardProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <GlassCard className="p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Knowledge Base Sources</div>
      <div className="space-y-1">
        {sources.map((src, i) => (
          <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="block text-[13px] text-[#5ec1ca] hover:underline">{src.title || src.url}</a>
        ))}
      </div>
    </GlassCard>
  );
}
