import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedUser {
  email: string;
  name: string | null;
  picture: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'jwt_secret_not_configured' });
    return;
  }

  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (
      typeof payload === 'string' ||
      typeof payload.email !== 'string' ||
      !payload.email
    ) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    req.user = {
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
