import { NextFunction, Request, Response } from 'express';
import { safeEqual } from './auth';

export function apiTokenAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'api_token_not_configured' });
    return;
  }

  const provided = req.header('x-api-token') || '';
  if (!safeEqual(provided, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}
