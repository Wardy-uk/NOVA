import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type {
  PortalAuthPayload,
  PortalUserAccessState,
  PortalUserAuthType,
  PortalUserRole,
} from '../../shared/portal-types.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { CustomRole } from './auth.js';
import { parseRoles, isAdmin } from '../utils/role-helpers.js';
import { queryOne, execute } from '../services/database.js';

declare global {
  namespace Express {
    interface Request {
      portalUser?: PortalAuthPayload;
    }
  }
}

const INTERNAL_ORG_EXTERNAL_ID = 'nurtur-internal';
const INTERNAL_ORG_NAME = 'Nurtur Limited';

async function getOrCreateInternalOrg(): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM portal_organisations WHERE external_id = ?`,
    [INTERNAL_ORG_EXTERNAL_ID],
  );
  if (existing) return existing.id;

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO portal_organisations (external_id, name, domain) OUTPUT INSERTED.id VALUES (?, ?, ?)`,
    [INTERNAL_ORG_EXTERNAL_ID, INTERNAL_ORG_NAME, 'nurtur.tech'],
  );
  return inserted!.id;
}

async function upsertInternalPortalUser(
  novaUserId: number,
  email: string,
  displayName: string,
  orgId: number,
  portalRole: PortalUserRole,
): Promise<number> {
  const externalId = `nova-user-${novaUserId}`;
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM portal_users WHERE external_id = ?`,
    [externalId],
  );

  if (existing) {
    await execute(
      `UPDATE portal_users
       SET org_id = ?, email = ?, display_name = ?, role = ?, auth_type = 'internal', access_state = 'active', last_login = GETUTCDATE()
       WHERE id = ?`,
      [orgId, email, displayName, portalRole, existing.id],
    );
    return existing.id;
  }

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO portal_users (external_id, org_id, email, display_name, role, auth_type, access_state)
     OUTPUT INSERTED.id VALUES (?, ?, ?, ?, ?, 'internal', 'active')`,
    [externalId, orgId, email, displayName, portalRole],
  );
  return inserted!.id;
}

const ACCESS_RANK: Record<string, number> = { hidden: 0, view: 1, edit: 2 };
const PORTAL_AREAS = ['servicedesk'];

function hasPortalAreaAccess(roleStr: string, allRoles: CustomRole[]): boolean {
  const userRoleIds = parseRoles(roleStr);
  const matched = allRoles.filter(r => userRoleIds.includes(r.id));
  if (matched.length === 0) return false;
  for (const area of PORTAL_AREAS) {
    let best = 0;
    for (const role of matched) {
      if (area in role.areas) {
        best = Math.max(best, ACCESS_RANK[role.areas[area] || 'hidden'] ?? 0);
      }
    }
    if (best >= 1) return true;
  }
  return false;
}

function mapPortalRole(roleStr: string): PortalUserRole {
  if (isAdmin(roleStr)) return 'admin';
  return 'org_admin';
}

function isInternalMode(settings: FileSettingsQueries): boolean {
  return (settings.get('portal_auth_mode') || 'internal') === 'internal';
}

export function portalAuthMiddleware(settingsQueries: FileSettingsQueries, getRoles?: () => CustomRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isInternalMode(settingsQueries)) {
      if (!req.user) {
        res.status(401).json({ ok: false, error: 'Not authenticated — log in to NOVA first' });
        return;
      }

      const allRoles = getRoles?.() ?? [];
      const allowed = isAdmin(req.user.role) || hasPortalAreaAccess(req.user.role, allRoles);
      if (!allowed) {
        res.status(403).json({ ok: false, error: 'Portal access requires Service Desk or Admin role' });
        return;
      }

      const portalRole = mapPortalRole(req.user.role);

      try {
        const orgId = await getOrCreateInternalOrg();
        const email = req.user.username + '@nurtur.tech';

        const userRecord = await queryOne<{ email: string | null; display_name: string | null }>(
          `SELECT email, display_name FROM users WHERE id = ?`,
          [req.user.id],
        );
        const actualEmail = userRecord?.email || email;
        const displayName = userRecord?.display_name || req.user.username;

        const portalUserId = await upsertInternalPortalUser(req.user.id, actualEmail, displayName, orgId, portalRole);

        req.portalUser = {
          userId: portalUserId,
          email: actualEmail,
          orgId,
          orgName: INTERNAL_ORG_NAME,
          role: portalRole,
          authType: 'internal',
        };
        next();
      } catch (err) {
        console.error('[portal-auth] Internal auth bridge failed:', err);
        res.status(500).json({ ok: false, error: 'Portal auth setup failed' });
      }
      return;
    }

    // OIDC mode: validate portal-specific JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Missing portal authentication token' });
      return;
    }

    const token = authHeader.slice(7);
    const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';

    try {
      const payload = jwt.verify(token, secret) as PortalAuthPayload & { iat: number; exp: number };
      const userRow = await queryOne<{
        email: string;
        org_id: number;
        role: string;
        auth_type: PortalUserAuthType;
        access_state: PortalUserAccessState;
      }>(
        `SELECT email, org_id, role, auth_type, access_state
         FROM portal_users
         WHERE id = ?`,
        [payload.userId],
      );
      if (!userRow) {
        res.status(401).json({ ok: false, error: 'Portal user not found' });
        return;
      }
      if (userRow.access_state !== 'active') {
        res.status(403).json({
          ok: false,
          error: userRow.access_state === 'disabled'
            ? 'This portal account is disabled'
            : 'This portal account has been removed',
        });
        return;
      }
      const org = userRow.org_id === payload.orgId
        ? { name: payload.orgName }
        : await queryOne<{ name: string }>(`SELECT name FROM portal_organisations WHERE id = ?`, [userRow.org_id]);
      req.portalUser = {
        userId: payload.userId,
        email: userRow.email || payload.email,
        orgId: userRow.org_id,
        orgName: org?.name || payload.orgName,
        role: (userRow.role as PortalUserRole) || payload.role,
        authType: userRow.auth_type,
      };
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'Invalid or expired portal token' });
    }
  };
}

export { isInternalMode };
