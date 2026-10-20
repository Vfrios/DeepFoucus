import { Request, Response, NextFunction } from 'express';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';
export interface DeviceInfo {
  device: DeviceType;
  hints: { chMobile: string | null; userAgent: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: DeviceInfo;
    }
  }
}

const TABLET_RE = /iPad|Tablet|Kindle|Silk|PlayBook|Nexus (7|9|10)|SM-T\d|KFAPWI|Xoom/i;
const MOBILE_RE = /iPhone|iPod|Windows Phone|Android.*Mobile|Mobile|IEMobile|BlackBerry/i;

/**
 * DETECÇÃO SERVER-SIDE
 * 1) Client Hint Sec-CH-UA-Mobile ("?1" = celular, "?0" = não-celular) quando presente.
 * 2) Fallback: parsing do User-Agent.
 * Limitação: iPadOS 13+ envia UA de Mac (vira "desktop" aqui). Por isso o front
 * refaz a detecção (touch + viewport) e é ele quem decide de fato.
 */
export function detectFromHeaders(h: Request['headers']): DeviceInfo {
  const ua = String(h['user-agent'] || '');
  const ch = (h['sec-ch-ua-mobile'] as string | undefined) ?? null;
  let device: DeviceType;
  if (ch === '?1') device = 'mobile';
  else if (TABLET_RE.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = 'tablet';
  else if (ch !== '?0' && MOBILE_RE.test(ua)) device = 'mobile';
  else device = 'desktop';
  return { device, hints: { chMobile: ch, userAgent: ua } };
}

export function deviceMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.device = detectFromHeaders(req.headers);
  res.vary('Sec-CH-UA-Mobile');
  next();
}
