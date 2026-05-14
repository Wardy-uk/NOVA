import { useTheme } from '../hooks/useTheme.js';
import type { CSSProperties } from 'react';

// ── Style definitions per mode ────────────────────────────────────────────

interface DevReviewStyleSet {
  glassCard: CSSProperties;
  meshBackground: CSSProperties;
  meshOpacityClass: string;        // Tailwind opacity class for mesh overlay
  titleGradient: CSSProperties;
  input: CSSProperties;
  modal: { backdrop: CSSProperties; content: CSSProperties };
  briefField: CSSProperties;
  briefFieldMono: CSSProperties;
  scrollbarThumbCss: string;       // raw CSS for ::-webkit-scrollbar-thumb
  scrollbarThumbHoverCss: string;
  toast: (kind: 'ok' | 'err') => CSSProperties;
  filterPill: (active: boolean) => CSSProperties;
  queueRow: (selected: boolean) => CSSProperties;
  selectBg: string;                // option className background
}

const dark: DevReviewStyleSet = {
  glassCard: {
    background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
  },
  meshBackground: {
    background: `
      radial-gradient(ellipse at 12% 18%, rgba(155,106,237,0.13) 0%, transparent 50%),
      radial-gradient(ellipse at 88% 25%, rgba(94,193,202,0.10) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 95%, rgba(249,115,22,0.05) 0%, transparent 55%)
    `,
    animation: 'drMesh 25s ease-in-out infinite alternate',
    zIndex: 0,
  },
  meshOpacityClass: 'opacity-70',
  titleGradient: {
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  input: {
    background: 'rgba(255,255,255,0.03)',
  },
  modal: {
    backdrop: {
      background: 'rgba(15,23,42,0.55)',
      backdropFilter: 'blur(6px)',
    },
    content: {
      background: 'rgba(30,36,48,0.97)',
      backdropFilter: 'blur(24px)',
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)',
    },
  },
  briefField: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    padding: '12px 14px',
  },
  briefFieldMono: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    padding: '12px 14px',
    maxHeight: '320px',
    overflowY: 'auto' as const,
  },
  scrollbarThumbCss: 'rgba(255,255,255,0.08)',
  scrollbarThumbHoverCss: 'rgba(255,255,255,0.15)',
  toast: (kind) => ({
    background: kind === 'ok' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
    border: `1px solid ${kind === 'ok' ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
    color: kind === 'ok' ? '#10b981' : '#ef4444',
    backdropFilter: 'blur(12px)',
    animation: 'drFadeIn 0.3s ease',
  }),
  filterPill: (active) => ({
    background: active ? 'linear-gradient(135deg, rgba(155,106,237,0.2), rgba(94,193,202,0.2))' : 'transparent',
    color: active ? '#c4b5fd' : '#64748b',
    border: `1px solid ${active ? 'rgba(155,106,237,0.4)' : 'rgba(255,255,255,0.05)'}`,
  }),
  queueRow: (selected) => ({
    background: selected ? 'rgba(155,106,237,0.1)' : 'rgba(255,255,255,0.02)',
    border: `1px solid ${selected ? 'rgba(155,106,237,0.4)' : 'rgba(255,255,255,0.06)'}`,
    boxShadow: selected ? '0 4px 20px rgba(155,106,237,0.15)' : 'none',
  }),
  selectBg: 'bg-[#272C33]',
};

const light: DevReviewStyleSet = {
  glassCard: {
    background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.01) 100%)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(0,0,0,0.08)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
  },
  meshBackground: {
    background: 'transparent',
    zIndex: 0,
  },
  meshOpacityClass: 'opacity-0',
  titleGradient: {
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    background: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  input: {
    background: 'rgba(0,0,0,0.03)',
  },
  modal: {
    backdrop: {
      background: 'rgba(0,0,0,0.3)',
      backdropFilter: 'blur(6px)',
    },
    content: {
      background: 'rgba(255,255,255,0.97)',
      backdropFilter: 'blur(24px)',
      border: '1px solid rgba(0,0,0,0.12)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8)',
    },
  },
  briefField: {
    background: 'rgba(0,0,0,0.03)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: '8px',
    padding: '12px 14px',
  },
  briefFieldMono: {
    background: 'rgba(0,0,0,0.03)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: '8px',
    padding: '12px 14px',
    maxHeight: '320px',
    overflowY: 'auto' as const,
  },
  scrollbarThumbCss: 'rgba(0,0,0,0.1)',
  scrollbarThumbHoverCss: 'rgba(0,0,0,0.2)',
  toast: (kind) => ({
    background: kind === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
    border: `1px solid ${kind === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
    color: kind === 'ok' ? '#059669' : '#dc2626',
    backdropFilter: 'blur(12px)',
    animation: 'drFadeIn 0.3s ease',
  }),
  filterPill: (active) => ({
    background: active ? 'linear-gradient(135deg, rgba(155,106,237,0.12), rgba(94,193,202,0.12))' : 'transparent',
    color: active ? '#7c3aed' : '#94a3b8',
    border: `1px solid ${active ? 'rgba(155,106,237,0.3)' : 'rgba(0,0,0,0.08)'}`,
  }),
  queueRow: (selected) => ({
    background: selected ? 'rgba(155,106,237,0.08)' : 'rgba(0,0,0,0.01)',
    border: `1px solid ${selected ? 'rgba(155,106,237,0.3)' : 'rgba(0,0,0,0.06)'}`,
    boxShadow: selected ? '0 4px 20px rgba(155,106,237,0.1)' : 'none',
  }),
  selectBg: 'bg-white',
};

export const devReviewStyles = { dark, light } as const;

/**
 * Hook that resolves the current theme and returns the appropriate style set.
 * 'light' -> light styles, everything else (dark / system) -> dark styles.
 */
export function useDevReviewTheme(): DevReviewStyleSet {
  const { theme } = useTheme();
  // system resolves via CSS class on <html>, but for inline styles we need
  // to resolve explicitly. The useTheme hook applies the class, and we check
  // the DOM to match:
  if (theme === 'light') return light;
  if (theme === 'system') {
    if (typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return light;
    }
  }
  return dark;
}
