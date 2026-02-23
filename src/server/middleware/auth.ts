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
