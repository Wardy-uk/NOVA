/* CALYX SHELVED — entire module commented out, restore when needed */
import type { CSSProperties } from 'react';

export const C = {
  bg0: '#1e2228', bg1: '#272C33', bg2: '#2f353d', bg3: '#343a42',
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669',
  amber: '#d97706', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
};

export const cardStyle: CSSProperties = {};
export const selectStyle: CSSProperties = {};
export const inputStyle: CSSProperties = {};
export const btnPrimary: CSSProperties = {};
export const btnSecondary: CSSProperties = {};
export const btnDanger: CSSProperties = {};
export const labelStyle: CSSProperties = {};

export function ReferenceTag(_props: { ref: string }) { return null; }
export function StatusBadge(_props: { status: string }) { return null; }
export function PriorityBadge(_props: { priority: string; glow?: boolean }) { return null; }
export function SlaCountdown(_props: { dueAt: any; isPaused?: any; metAt?: any; isFrt?: any }) { return null; }
export function SloProgress(_props: { targetAt: any; warningAt?: any; completedAt?: any; breached?: any }) { return null; }
export function AgentAvatar(_props: { name: string; size?: number }) { return null; }
export function EmptyState(_props: { icon: any; title: string; subtitle?: string }) { return null; }
export function ragColor(_value: number, _target: number, _isHigherBetter: boolean): string { return ''; }
export function formatDate(_d: string): string { return ''; }
export function formatDateTime(_d: string): string { return ''; }
export async function calyxApi<T = any>(_path: string, _opts?: RequestInit): Promise<T> { return {} as T; }
export function useCalyxData<T>(_path: string, _deps: any[] = []): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  return { data: null, loading: false, error: null, refetch: () => {} };
}
export function SlidePanel(_props: { open: boolean; onClose: () => void; title: string; children: any; width?: number }) { return null; }
