import { NextFunction, Request, Response } from 'express';
import { isPrimaryOwnerEmail } from '../lib/roles';

export function requirePrimaryOwnerEmail(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const configuredEmail = process.env.EMAIL_VITOR;
  if (configuredEmail !== undefined && !isPrimaryOwnerEmail(req.user.email, configuredEmail)) {
    res.status(403).json({ error: 'primary_owner_required' });
    return;
  }

  next();
}
