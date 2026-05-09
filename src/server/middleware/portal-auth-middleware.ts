import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { PortalAuthPayload } from '../../shared/portal-types.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

declare global {
  namespace Express {
    interface Request {
      portalUser?: PortalAuthPayload;
    }
  }
}

export function portalAuthMiddleware(settingsQueries: FileSettingsQueries) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Missing portal authentication token' });
      return;
    }

    const token = authHeader.slice(7);
    const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';

    try {
      const payload = jwt.verify(token, secret) as PortalAuthPayload & { iat: number; exp: number };
      req.portalUser = {
        userId: payload.userId,
        email: payload.email,
        orgId: payload.orgId,
        orgName: payload.orgName,
        role: payload.role,
      };
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'Invalid or expired portal token' });
    }
  };
}
