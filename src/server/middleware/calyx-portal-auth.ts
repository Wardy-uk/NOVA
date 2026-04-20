import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { FileSettingsQueries } from '../db/settings-store.js';

export interface PortalUser {
  requesterId: number;
  email: string;
  type: 'portal';
}

declare global {
  namespace Express {
    interface Request {
      portalUser?: PortalUser;
    }
  }
}

const SETTINGS_KEY = 'calyx_portal_jwt_secret';

export function getPortalJwtSecret(settingsQueries: FileSettingsQueries): string {
  let secret = settingsQueries.get(SETTINGS_KEY);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    settingsQueries.set(SETTINGS_KEY, secret);
    console.log('[Calyx Portal] Generated new portal JWT secret');
  }
  return secret;
}

export function portalAuthMiddleware(settingsQueries: FileSettingsQueries) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.calyx_portal_token;
    if (!token) {
      res.status(401).json({ ok: false, error: 'Portal authentication required' });
      return;
    }

    try {
      const secret = getPortalJwtSecret(settingsQueries);
      const payload = jwt.verify(token, secret) as PortalUser;
      if (payload.type !== 'portal') {
        res.status(401).json({ ok: false, error: 'Invalid portal token' });
        return;
      }
      req.portalUser = payload;
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'Portal session expired or invalid' });
      return;
    }
  };
}
