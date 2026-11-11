import { NextFunction, Request, Response } from 'express';
import type { Role } from '../lib/roles';

export function requireRole(roles: readonly Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    next();
  };
}
