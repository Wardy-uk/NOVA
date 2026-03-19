import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { parseRoles, isAdmin } from '../utils/role-helpers.js';

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
      // Admin always has full access
      if (isAdmin(req.user.role)) {
        next();
        return;
      }
      const allRoleDefs = getRoles();
      const userRoleIds = parseRoles(req.user!.role);
      const matched = allRoleDefs.filter(r => userRoleIds.includes(r.id));
      if (matched.length === 0) {
        res.status(403).json({ ok: false, error: 'Unknown role' });
        return;
      }
      // Pass if the user meets the required level in ANY of the specified areas
      const required = ACCESS_LEVELS[level] ?? 999;
      for (const a of areas) {
        let bestAccess = 0;
        for (const role of matched) {
          bestAccess = Math.max(bestAccess, ACCESS_LEVELS[role.areas[a] || 'hidden'] ?? 0);
        }
        if (bestAccess >= required) {
          next();
          return;
        }
      }
      res.status(403).json({ ok: false, error: 'Insufficient permissions for this area' });
    };
  };
}

export type AreaAccessGuard = ReturnType<typeof createAreaAccessGuard>;

export function authMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Accept token from Authorization header or ?token= query param (for <img src> etc.)
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

    try {
      const payload = jwt.verify(token, secret) as AuthPayload;
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
  };
}
