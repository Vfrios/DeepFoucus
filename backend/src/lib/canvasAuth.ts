import crypto from 'crypto';
import type { Db } from 'mongodb';
import { sendPushToAll, sendPushToUser } from '../routes/push';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TOKEN_TTL_DAYS = 29;
const WARN_DAYS_THRESHOLD = 5;
const TIME_ZONE = 'America/Sao_Paulo';
const AUTH_DOC_ID = 'puc' as const;

export interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface CanvasAuthDoc extends EncryptedPayload {
  _id: typeof AUTH_DOC_ID;
  saved_at: Date;
  expires_at: Date;
  canvas_user_name?: string | null;
  canvas_user_id?: number | null;
  expired_401?: boolean;
  last_401_at?: Date | null;
  last_push_date?: string | null;
  last_push_reason?: 'expiring' | 'expired_401' | null;
}

export interface CanvasTokenStatus {
  configured: boolean;
  decryptError?: boolean;
  savedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  expiringSoon: boolean;
  expired: boolean;
  expired401: boolean;
  canvasUserName: string | null;
}

function getEncryptionKey(): Buffer {
  const hex = (process.env.ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY ausente ou inválida (esperado 64 caracteres hex / 32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptCanvasToken(plainToken: string): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

export function decryptCanvasToken(payload: EncryptedPayload): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(now);
}

export function computeDaysRemaining(expiresAt: Date, now = new Date()): number {
  const diffMs = expiresAt.getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

export async function saveCanvasToken(
  db: Db,
  plainToken: string,
  userInfo?: { id?: number | null; name?: string | null }
): Promise<CanvasTokenStatus> {
  const encrypted = encryptCanvasToken(plainToken.trim());
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.collection<CanvasAuthDoc>('canvas_auth').updateOne(
    { _id: AUTH_DOC_ID },
    {
      $set: {
        ...encrypted,
        saved_at: now,
        expires_at: expiresAt,
        canvas_user_name: userInfo?.name ?? null,
        canvas_user_id: typeof userInfo?.id === 'number' ? userInfo.id : null,
        expired_401: false,
        last_401_at: null,
        last_push_date: null,
        last_push_reason: null,
      },
    },
    { upsert: true }
  );

  return getCanvasTokenStatus(db, now);
}

export async function getCanvasToken(
  db: Db
): Promise<{ token: string | null; doc: CanvasAuthDoc | null; decryptError?: boolean }> {
  const doc = await db.collection<CanvasAuthDoc>('canvas_auth').findOne({ _id: AUTH_DOC_ID });
  if (!doc) return { token: null, doc: null };
  try {
    const token = decryptCanvasToken({
      iv: doc.iv,
      tag: doc.tag,
      ciphertext: doc.ciphertext,
    });
    return { token, doc };
  } catch {
    return { token: null, doc, decryptError: true };
  }
}

export async function getCanvasTokenStatus(db: Db, now = new Date()): Promise<CanvasTokenStatus> {
  const doc = await db.collection<CanvasAuthDoc>('canvas_auth').findOne({ _id: AUTH_DOC_ID });
  if (!doc) {
    return {
      configured: false,
      savedAt: null,
      expiresAt: null,
      daysRemaining: null,
      expiringSoon: false,
      expired: false,
      expired401: false,
      canvasUserName: null,
    };
  }

  let decryptError = false;
  try {
    decryptCanvasToken({ iv: doc.iv, tag: doc.tag, ciphertext: doc.ciphertext });
  } catch {
    decryptError = true;
  }

  const expiresAt = doc.expires_at instanceof Date ? doc.expires_at : new Date(doc.expires_at);
  const savedAt = doc.saved_at instanceof Date ? doc.saved_at : new Date(doc.saved_at);
  const daysRemaining = computeDaysRemaining(expiresAt, now);
  const expired401 = Boolean(doc.expired_401);
  const expired = decryptError || expired401 || daysRemaining <= 0;
  const expiringSoon = !expired && daysRemaining <= WARN_DAYS_THRESHOLD;

  return {
    configured: true,
    ...(decryptError ? { decryptError: true } : {}),
    savedAt: savedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    daysRemaining,
    expiringSoon,
    expired,
    expired401,
    canvasUserName: doc.canvas_user_name ?? null,
  };
}

/**
 * Envia Web Push de alerta do token PUC (no máximo 1 por dia).
 * Reaproveita o sistema de Web Push existente (`sendPushToUser` / `sendPushToAll`).
 */
export async function maybeSendCanvasTokenPush(
  db: Db,
  reason: 'expiring' | 'expired_401',
  daysRemaining?: number
): Promise<boolean> {
  const today = todayKey();
  const col = db.collection<CanvasAuthDoc>('canvas_auth');
  const claim = await col.updateOne(
    { _id: AUTH_DOC_ID, last_push_date: { $ne: today } },
    { $set: { last_push_date: today, last_push_reason: reason } }
  );
  if (claim.modifiedCount === 0) return false;

  const payload =
    reason === 'expired_401'
      ? {
          title: 'PUC Canvas: token expirado',
          body: 'O token do Canvas retornou 401. Cole um novo token na página PUC.',
          url: '/?page=puc',
        }
      : {
          title: 'PUC Canvas: token perto de expirar',
          body:
            typeof daysRemaining === 'number' && daysRemaining > 0
              ? `Seu token do Canvas expira em ${daysRemaining} dia(s). Gere e cole um novo na página PUC.`
              : 'Seu token do Canvas está prestes a expirar. Cole um novo na página PUC.',
          url: '/?page=puc',
        };

  try {
    const ownerEmail = (process.env.EMAIL_VITOR || '').trim();
    let sent = 0;
    if (ownerEmail) {
      const res = await sendPushToUser(ownerEmail, payload);
      sent = res.sent;
    }
    if (sent === 0) {
      const res = await sendPushToAll(payload);
      sent = res.sent;
    }
    if (sent === 0) {
      // Nenhuma subscription entregue: libera a trava para tentar novamente depois
      await col.updateOne(
        { _id: AUTH_DOC_ID, last_push_date: today },
        { $set: { last_push_date: null } }
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error('[puc/push] falha ao enviar alerta de token:', err instanceof Error ? err.message : String(err));
    await col.updateOne(
      { _id: AUTH_DOC_ID, last_push_date: today },
      { $set: { last_push_date: null } }
    );
    return false;
  }
}

export async function markCanvasToken401(db: Db): Promise<void> {
  await db.collection<CanvasAuthDoc>('canvas_auth').updateOne(
    { _id: AUTH_DOC_ID },
    { $set: { expired_401: true, last_401_at: new Date() } }
  );
  await maybeSendCanvasTokenPush(db, 'expired_401');
}

