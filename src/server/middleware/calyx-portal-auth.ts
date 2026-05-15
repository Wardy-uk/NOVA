/* CALYX SHELVED — entire module commented out */
import type { Request, Response, NextFunction } from 'express';

export interface PortalUser {
  requesterId: number;
  email: string;
  type: 'portal';
}

declare global {
  namespace Express {
    interface Request {
      calyxPortalUser?: PortalUser;
    }
  }
}

export function getPortalJwtSecret(): string { return ''; }
export function portalAuthMiddleware(..._args: any[]) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
