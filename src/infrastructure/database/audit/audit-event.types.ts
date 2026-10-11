export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditContext {
  actor?: string;
  reason?: string;
  correlationId?: string;
}

export interface AuditEvent {
  tableName: string;
  recordId: string;
  operation: AuditOperation;
  actor?: string;
  reason?: string;
  oldValue?: unknown;
  newValue?: unknown;
  correlationId?: string;
}
