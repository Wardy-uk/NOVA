import type { ReactNode } from 'react';
import { useDevReviewTheme } from '../../utils/devReviewTheme.js';

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
  const t = useDevReviewTheme();
  return (
    <div
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={t.glassCard}
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
