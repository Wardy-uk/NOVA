import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { parseRoles, isAdmin, isSuperAdmin } from '../utils/role-helpers.js';
import { ssoLogger } from '../services/sso-logger.js';

// Default access for areas not explicitly set in saved custom roles.
// Prevents new areas from being invisible until admin manually updates every role.
const AREA_DEFAULTS: Record<string, string> = {
  training: 'edit',
  wallboards: 'view',
  mi: 'hidden',
  devreview: 'hidden',
};

export interface AuthPayload {
  id: number;
  username: string;
  role: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/** Middleware that checks req.user.role against allowed roles. Must come after authMiddleware. */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Not authenticated' });
      return;
    }
    const userRoles = parseRoles(req.user.role);
    if (!userRoles.some(r => roles.includes(r))) {
      res.status(403).json({ ok: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/** Middleware that requires super_admin role. */
export function requireSuperAdmin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Not authenticated' });
      return;
    }
    if (!isSuperAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Super admin access required' });
      return;
    }
    next();
  };
}

/** Custom role definition with per-area access levels */
export interface CustomRole {
  id: string;
  name: string;
  areas: Record<string, 'hidden' | 'view' | 'edit'>;
}

const ACCESS_LEVELS: Record<string, number> = { hidden: 0, view: 1, edit: 2 };

/**
 * Factory that creates area-aware access guard middleware.
 * Admin users always pass. Other users checked against their custom role's area access.
 * Pass an array of area IDs to allow access if the user has the required level in ANY of them.
 */
export function createAreaAccessGuard(getRoles: () => CustomRole[]) {
  return function requireAreaAccess(area: string | string[], level: 'view' | 'edit') {
    const areas = Array.isArray(area) ? area : [area];
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ ok: false, error: 'Not authenticated' });
        return;
      }
      // Admin and super_admin always have full access
      if (isAdmin(req.user.role)) {
        next();
        return;
      }
      const allRoleDefs = getRoles();
      const userRoleIds = parseRoles(req.user!.role);
      const matched = allRoleDefs.filter(r => userRoleIds.includes(r.id));
      if (matched.length === 0) {
        ssoLogger.warn('area_access', `Role not found in custom roles — denying`, {
          user: req.user!.username, userRole: req.user!.role,
          requiredAreas: areas, availableRoleIds: allRoleDefs.map(r => r.id),
        });
        res.status(403).json({ ok: false, error: 'Unknown role' });
        return;
      }
      // Pass if the user meets the required level in ANY of the specified areas
      const required = ACCESS_LEVELS[level] ?? 999;
      for (const a of areas) {
        let bestAccess = 0;
        // Check if ANY matched role has this area defined
        let areaDefinedInAnyRole = false;
        for (const role of matched) {
          if (a in role.areas) {
            areaDefinedInAnyRole = true;
            bestAccess = Math.max(bestAccess, ACCESS_LEVELS[role.areas[a] || 'hidden'] ?? 0);
          }
        }
        // If no role defines this area, fall back to AREA_DEFAULTS
        if (!areaDefinedInAnyRole && a in AREA_DEFAULTS) {
          bestAccess = ACCESS_LEVELS[AREA_DEFAULTS[a]] ?? 0;
        }
        if (bestAccess >= required) {
          next();
          return;
        }
      }
      ssoLogger.warn('area_access', `Insufficient area access — denying`, {
        user: req.user!.username, userRole: req.user!.role,
        requiredAreas: areas, level,
        matchedRoles: matched.map(r => ({ id: r.id, areas: r.areas })),
      });
      res.status(403).json({ ok: false, error: 'Insufficient permissions for this area' });
    };
  };
}

export type AreaAccessGuard = ReturnType<typeof createAreaAccessGuard>;

export function authMiddleware(secret: string, getUserRole?: (id: number) => Promise<string | undefined>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({ ok: false, error: 'Not authenticated' });
      return;
    }

    let payload: AuthPayload;
    try {
      payload = jwt.verify(token, secret) as AuthPayload;
    } catch {
      res.status(401).json({ ok: false, error: 'Invalid or expired token' });
      return;
    }

    req.user = payload;
    if (getUserRole) {
      try {
        const freshRole = await getUserRole(payload.id);
        if (freshRole !== undefined) req.user = { ...payload, role: freshRole };
      } catch (err) {
        console.warn('[auth] Failed to refresh user role from DB, using JWT role:', err instanceof Error ? err.message : err);
      }
    }
    next();
  };
}
