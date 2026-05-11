import type { ReactNode } from 'react';

export function GlassCard({
  children,
  className = '',
  accent,
  accentGradient,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
  accentGradient?: string;
}) {
  const gradient = accentGradient || '#10b981 30%, #5ec1ca 70%';
  return (
    <div
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {accent && (
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${gradient}, transparent)`,
            backgroundSize: '200% 100%',
            animation: 'qShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}
