import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y); // comparação em tempo constante
}

/** Exige "Authorization: Bearer <API_TOKEN>". */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_TOKEN || '';
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!expected || !safeEqual(token, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
