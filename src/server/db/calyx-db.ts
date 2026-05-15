/* CALYX SHELVED — entire module commented out */
export interface AuditEntry {
  entityType: string;
  entityId: number | null;
  action: string;
  actorType: 'agent' | 'requester' | 'system';
  actorId: number | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string;
}
export function auditLog(..._args: any[]) {}
export function getCalyxDb(): null { return null; }
export function initializeCalyxSchema(..._args: any[]) {}
export function seedCalyxData(..._args: any[]) {}
