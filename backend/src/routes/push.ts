import { Router } from 'express';
import webpush from 'web-push';
import { getDb } from '../lib/mongo';
import { listEvents } from '../lib/google';

const r = Router();
let vapidOk = false;

/** Chamado em index.ts DEPOIS do dotenv. Sem chaves VAPID o push fica desativado. */
export function initVapid() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidOk = true;
  } else {
    console.warn('[push] VAPID_* ausente: notificações desativadas');
  }
}

/** Envia para todas as subscriptions; remove as expiradas (404/410). */
export async function sendPushToAll(payload: { title: string; body?: string; url?: string }) {
  if (!vapidOk) return { sent: 0, removed: 0 };
  const db = await getDb();
  const subs = await db.collection<any>('subscriptions').find().toArray();
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(payload));
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await db.collection('subscriptions').deleteOne({ endpoint: s.endpoint });
          removed++;
        }
      }
    })
  );
  return { sent, removed };
}

/** Fire-and-forget usado pelas rotas de tarefas. */
export function notify(title: string, body?: string) {
  sendPushToAll({ title, body }).catch(() => undefined);
}

/**
 * JOB DE LEMBRETE: a cada 60s procura eventos que começam em até 15 min
 * e avisa uma única vez por evento (Set em memória; reinício do serviço pode repetir 1x).
 */
const notified = new Set<string>();
export function startReminderJob() {
  setInterval(async () => {
    if (!vapidOk) return;
    try {
      const db = await getDb();
      if ((await db.collection('subscriptions').countDocuments()) === 0) return;
      const now = new Date();
      const events = await listEvents(now, 1);
      for (const e of events) {
        if (e.allDay) continue;
        const min = (new Date(e.start).getTime() - now.getTime()) / 60000;
        const key = e.id + e.start;
        if (min > 0 && min <= 15 && !notified.has(key)) {
          notified.add(key);
          if (notified.size > 500) notified.clear();
          await sendPushToAll({ title: `Em ${Math.ceil(min)} min: ${e.title}`, body: e.location });
        }
      }
    } catch {
      /* Google/Mongo indisponível: tenta de novo no próximo ciclo */
    }
  }, 60_000);
}

r.get('/key', (_req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

r.post('/subscribe', async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys) {
    res.status(400).json({ error: 'subscription inválida' });
    return;
  }
  const db = await getDb();
  await db
    .collection<any>('subscriptions')
    .updateOne({ endpoint: sub.endpoint }, { $set: { endpoint: sub.endpoint, subscription: sub, criadoEm: new Date() } }, { upsert: true });
  res.status(201).json({ ok: true });
});

r.post('/test', async (_req, res) => {
  if (!vapidOk) {
    res.status(503).json({ error: 'vapid_not_configured' });
    return;
  }
  res.json(await sendPushToAll({ title: 'Wall Dashboard', body: 'Notificação de teste ✅' }));
});

export default r;
