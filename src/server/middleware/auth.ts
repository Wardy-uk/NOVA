import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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
    if (!roles.includes(req.user.role)) {
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
 */
export function createAreaAccessGuard(getRoles: () => CustomRole[]) {
  return function requireAreaAccess(area: string, level: 'view' | 'edit') {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ ok: false, error: 'Not authenticated' });
        return;
      }
      // Admin always has full access
      if (req.user.role === 'admin') {
        next();
        return;
      }
      const roles = getRoles();
      const role = roles.find(r => r.id === req.user!.role);
      if (!role) {
        res.status(403).json({ ok: false, error: 'Unknown role' });
        return;
      }
      const userAccess = role.areas[area] || 'hidden';
      if ((ACCESS_LEVELS[userAccess] ?? 0) >= (ACCESS_LEVELS[level] ?? 999)) {
        next();
        return;
      }
      res.status(403).json({ ok: false, error: 'Insufficient permissions for this area' });
    };
  };
}

export type AreaAccessGuard = ReturnType<typeof createAreaAccessGuard>;

export function authMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Not authenticated' });
      return;
    }

    try {
      const payload = jwt.verify(header.slice(7), secret) as AuthPayload;
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
  };
}
