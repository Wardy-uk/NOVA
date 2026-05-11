export interface KeyboardShortcut {
  key: string;
  label: string;
}

export function KeyboardHints({ shortcuts }: { shortcuts: KeyboardShortcut[] }) {
  if (!shortcuts.length) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-t border-[#2f353d] text-[9px] text-neutral-500">
      {shortcuts.map(s => (
        <span key={s.key} className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] text-neutral-400 font-mono">{s.key}</kbd>
          <span>{s.label}</span>
        </span>
      ))}
    </div>
  );
}
