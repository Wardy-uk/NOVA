import { query, queryOne } from './database.js';
import type { PortalUserRole, PortalUserAuthType } from '../../shared/portal-types.js';

// Which organisations may a portal user enter, and may they write to them?
//
// Three sources, in order of authority:
//   1. HOME org  — portal_users.org_id. Always present, always writable.
//   2. MEMBER    — explicit rows in portal_user_orgs. Writable. This is how a
//                  customer contact who genuinely oversees several brands gets
//                  more than one org.
//   3. VIEW-AS   — internal Nurtur staff (auth_type = 'internal', admin/org_admin)
//                  may enter ANY org, READ-ONLY. This is a support/QA lens: the
//                  portal renders exactly as that customer sees it. No config
//                  needed when a customer is onboarded.
//
// Read-only is enforced server-side in the portal auth middleware, not here — this
// module only decides membership. Never grant write from a view-as membership: it
// would let staff act as a customer with no audit trail of who really did it.

export type PortalOrgAccessKind = 'home' | 'member' | 'view-as';

export interface PortalOrgMembership {
  orgId: number;
  orgName: string;
  kind: PortalOrgAccessKind;
  role: PortalUserRole;
  /** False for view-as: every mutating request is rejected. */
  canWrite: boolean;
}

const STAFF_VIEW_AS_ROLES: PortalUserRole[] = ['admin', 'org_admin'];

function canStaffViewAs(authType: PortalUserAuthType | undefined, role: PortalUserRole): boolean {
  return authType === 'internal' && STAFF_VIEW_AS_ROLES.includes(role);
}

/**
 * Every org this user may switch into, home org first. Used by the org switcher
 * and to validate a requested active org.
 */
export async function listMemberships(user: {
  userId: number;
  homeOrgId: number;
  role: PortalUserRole;
  authType?: PortalUserAuthType;
}): Promise<PortalOrgMembership[]> {
  const memberships = new Map<number, PortalOrgMembership>();

  const home = await queryOne<{ id: number; name: string }>(
    `SELECT id, name FROM portal_organisations WHERE id = ?`,
    [user.homeOrgId],
  );
  if (home) {
    memberships.set(home.id, {
      orgId: home.id,
      orgName: home.name,
      kind: 'home',
      role: user.role,
      canWrite: true,
    });
  }

  const explicit = await query<{ org_id: number; name: string; role: string | null }>(
    `SELECT puo.org_id, po.name, puo.role
     FROM portal_user_orgs puo
     INNER JOIN portal_organisations po ON po.id = puo.org_id
     WHERE puo.portal_user_id = ?`,
    [user.userId],
  );
  for (const row of explicit) {
    if (memberships.has(row.org_id)) continue;
    memberships.set(row.org_id, {
      orgId: row.org_id,
      orgName: row.name,
      kind: 'member',
      role: (row.role as PortalUserRole) || user.role,
      canWrite: true,
    });
  }

  if (canStaffViewAs(user.authType, user.role)) {
    const all = await query<{ id: number; name: string }>(
      `SELECT id, name FROM portal_organisations ORDER BY name`,
    );
    for (const org of all) {
      if (memberships.has(org.id)) continue;
      memberships.set(org.id, {
        orgId: org.id,
        orgName: org.name,
        kind: 'view-as',
        // Staff see the portal as a customer leader would — enough to see the org's
        // dashboards, but the role never grants write because canWrite is false.
        role: 'manager',
        canWrite: false,
      });
    }
  }

  const list = [...memberships.values()];
  list.sort((a, b) => {
    if (a.kind === 'home') return -1;
    if (b.kind === 'home') return 1;
    return a.orgName.localeCompare(b.orgName);
  });
  return list;
}

/**
 * Resolve the org a request should run against. `requestedOrgId` comes from the
 * client (X-Portal-Org) and is UNTRUSTED — it is only honoured if it resolves to a
 * real membership. Anything else falls back to the home org, so a forged header
 * downgrades to the user's own data rather than granting access to someone else's.
 */
export async function resolveActiveOrg(
  user: { userId: number; homeOrgId: number; role: PortalUserRole; authType?: PortalUserAuthType },
  requestedOrgId: number | null,
): Promise<PortalOrgMembership | null> {
  const memberships = await listMemberships(user);
  if (!memberships.length) return null;

  if (requestedOrgId && requestedOrgId !== user.homeOrgId) {
    const match = memberships.find(m => m.orgId === requestedOrgId);
    if (match) return match;
    console.warn(`[portal] user ${user.userId} requested org ${requestedOrgId} without membership — falling back to home org`);
  }

  return memberships.find(m => m.kind === 'home') ?? memberships[0];
}
