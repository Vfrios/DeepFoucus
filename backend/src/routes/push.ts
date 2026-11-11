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

export async function sendPushToUser(email: string, payload: { title: string; body?: string; url?: string }) {
  if (!vapidOk) return { sent: 0, removed: 0 };
  const db = await getDb();
  const subs = await db.collection<any>('subscriptions').find({ email }).toArray();
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(payload));
        sent++;
      } catch (error: unknown) {
        const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number((error as { statusCode: unknown }).statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await db.collection('subscriptions').deleteOne({ endpoint: s.endpoint });
          removed++;
        } else {
          console.error('[push] failed to notify user:', error instanceof Error ? error.message : String(error));
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

  setInterval(async () => {
    if (!vapidOk) return;
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value);
      if (hour < 8 || hour >= 22) return;

      const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(now);
      const start = new Date(`${key}T00:00:00.000-03:00`);
      const tomorrow = new Date(start.getTime() + 86400000);
      const db = await getDb();
      const profiles = await db.collection<any>('profile').find({
        email: { $type: 'string' },
        peso: { $gt: 0 },
      }).toArray();

      await Promise.all(profiles.map(async (profile) => {
        const goal = Math.round(profile.peso * 35);
        const totals = await db.collection<any>('water_logs').aggregate([
          { $match: { email: profile.email, data: { $gte: start, $lt: tomorrow } } },
          { $group: { _id: null, total: { $sum: '$ml' } } },
        ]).toArray();
        const consumed = Math.max(0, totals[0]?.total || 0);
        if (consumed >= goal) return;
        await sendPushToUser(profile.email, {
          title: 'Hora de se hidratar!',
          body: `Hora de se hidratar! Você bebeu ${consumed} ml de ${goal} ml hoje.`,
        });
      }));
    } catch (error) {
      console.error('[push] water reminder job failed:', error instanceof Error ? error.message : String(error));
    }
  }, 60 * 60_000);
}

r.get('/key', (_req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

r.post('/status', async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
    res.status(400).json({ error: 'endpoint inválido' });
    return;
  }
  const db = await getDb();
  const subscription = await db.collection('subscriptions').findOne({ endpoint }, { projection: { _id: 1 } });
  if (subscription) {
    await db.collection('subscriptions').updateOne({ endpoint }, { $set: { email: req.user!.email } });
  }
  res.json({ subscribed: subscription !== null });
});

r.post('/subscribe', async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys) {
    res.status(400).json({ error: 'subscription inválida' });
    return;
  }
  const db = await getDb();
  await db
    .collection<any>('subscriptions')
    .updateOne(
      { endpoint: sub.endpoint },
      { $set: { endpoint: sub.endpoint, subscription: sub, email: req.user!.email, criadoEm: new Date() } },
      { upsert: true }
    );
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
