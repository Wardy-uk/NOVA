import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Optional badge/status element shown to the right of the title */
  badge?: ReactNode;
  /** Whether section starts collapsed (default: true) */
  defaultCollapsed?: boolean;
  /** Skip the outer card border/bg — just render header + collapsible content */
  borderless?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, badge, defaultCollapsed = true, borderless, children }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={borderless ? '' : 'border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden'}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center justify-between px-5 py-3 hover:bg-[#363d47] transition-colors ${borderless ? 'rounded-lg' : ''}`}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3.5 h-3.5 text-neutral-500 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">{title}</span>
          {badge}
        </div>
      </button>
      {!collapsed && (
        <div className={borderless ? 'pt-1' : 'px-5 pb-4 pt-1'}>
          {children}
        </div>
      )}
    </div>
  );
}
