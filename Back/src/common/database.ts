import type { EntityManager } from 'typeorm';

export function recordAudit(
  manager: EntityManager,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: object,
) {
  return manager.query(
    'INSERT INTO audit_events (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actorId, action, targetType, targetId, JSON.stringify(details)],
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
