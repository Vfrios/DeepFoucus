import { Router } from 'express';
import webpush from 'web-push';
import { getDb } from '../lib/mongo';
import { listEvents } from '../lib/google';

const r = Router();
let vapidOk = false;
const TIME_ZONE = 'America/Sao_Paulo';
const WATER_REMINDER_AFTER_MS = 90 * 60 * 1000;

type ReminderPayload = { title: string; body?: string; url?: string };

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(date);
}

function localClock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function dayName(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, weekday: 'long' })
    .format(date).toLocaleLowerCase('pt-BR');
}

function mealKey(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function validClock(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function claimReminder(key: string, email: string, kind: string, now: Date): Promise<boolean> {
  const db = await getDb();
  try {
    await db.collection('push_reminders').insertOne({ _id: key as any, email, kind, sentAt: now });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function claimReminderAfterCooldown(
  key: string,
  email: string,
  kind: string,
  now: Date,
  cooldownMs: number
): Promise<boolean> {
  const db = await getDb();
  const reminders = db.collection('push_reminders');
  const refreshed = await reminders.updateOne(
    { _id: key as any, sentAt: { $lte: new Date(now.getTime() - cooldownMs) } },
    { $set: { email, kind, sentAt: now } }
  );
  if (refreshed.modifiedCount) return true;
  try {
    await reminders.insertOne({ _id: key as any, email, kind, sentAt: now });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function sendReminder(
  key: string,
  email: string,
  kind: string,
  payload: ReminderPayload,
  now: Date
): Promise<number> {
  if (!(await claimReminder(key, email, kind, now))) return 0;
  const result = await sendPushToUser(email, payload);
  if (result.sent === 0) {
    const db = await getDb();
    await db.collection('push_reminders').deleteOne({ _id: key as any });
  }
  return result.sent;
}

async function sendReminderWithCooldown(
  key: string,
  email: string,
  kind: string,
  payload: ReminderPayload,
  now: Date,
  cooldownMs: number
): Promise<number> {
  if (!(await claimReminderAfterCooldown(key, email, kind, now, cooldownMs))) return 0;
  const result = await sendPushToUser(email, payload);
  if (result.sent === 0) {
    const db = await getDb();
    await db.collection('push_reminders').deleteOne({ _id: key as any, sentAt: now });
  }
  return result.sent;
}

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

async function checkHealthReminders(email: string, now = new Date()) {
  const clock = localClock(now);
  const hour = Number(clock.slice(0, 2));
  if (hour < 8 || hour >= 22) return { quietHours: true, sent: 0 };

  const db = await getDb();
  const today = dateKey(now);
  const dayStart = new Date(`${today}T00:00:00.000-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const [profile, waterTotals, lastWater, diet, mealLogs, workout] = await Promise.all([
    db.collection<any>('profile').findOne({ email }),
    db.collection<any>('water_logs').aggregate([
      { $match: { email, data: { $gte: dayStart, $lt: dayEnd } } },
      { $group: { _id: null, total: { $sum: '$ml' } } },
    ]).toArray(),
    db.collection<any>('water_logs').find({ email }).sort({ data: -1 }).limit(1).next(),
    db.collection<any>('diets').find({ email }).sort({ geradoEm: -1 }).limit(1).next(),
    db.collection<any>('meal_logs').find({ email, data: today }).toArray(),
    db.collection<any>('workouts').findOne({ email, diaSemana: dayName(now) }),
  ]);

  let sent = 0;
  const waterGoal = typeof profile?.peso === 'number' && profile.peso > 0
    ? Math.round(profile.peso * 35)
    : 0;
  const waterConsumed = Math.max(0, Number(waterTotals[0]?.total) || 0);
  const lastWaterAt = lastWater?.data instanceof Date ? lastWater.data : lastWater?.data ? new Date(lastWater.data) : null;
  if (waterGoal > 0 && waterConsumed < waterGoal && (!lastWaterAt || now.getTime() - lastWaterAt.getTime() > WATER_REMINDER_AFTER_MS)) {
    sent += await sendReminderWithCooldown(
      `water:${email}:${today}`,
      email,
      'water',
      { title: 'Hora de se hidratar!', body: `Você bebeu ${waterConsumed} ml de ${waterGoal} ml hoje.`, url: '/?page=health' },
      now,
      WATER_REMINDER_AFTER_MS
    );
  }

  const rawMeals = Array.isArray(diet?.refeicoes) ? diet.refeicoes : Array.isArray(diet?.dieta) ? diet.dieta : [];
  const completedMeals = new Set(
    mealLogs.filter((log) => typeof log?.tipoRefeicao === 'string').map((log) => mealKey(log.tipoRefeicao))
  );
  for (let index = 0; index < rawMeals.length; index++) {
    const meal = rawMeals[index];
    if (!meal || typeof meal.nome !== 'string' || !validClock(meal.horario)) continue;
    if (clock < meal.horario || completedMeals.has(mealKey(meal.nome))) continue;
    sent += await sendReminder(
      `meal:${email}:${today}:${mealKey(meal.nome)}:${meal.horario}`,
      email,
      'meal',
      { title: 'Refeição pendente', body: `Você esqueceu de registrar ${meal.nome}!`, url: '/?page=health' },
      now
    );
  }

  const workoutTime = validClock(workout?.horario)
    ? workout.horario
    : Array.isArray(profile?.disponibilidadePorDia?.[dayName(now)])
      ? profile.disponibilidadePorDia[dayName(now)].find(validClock)
      : undefined;
  if (workout && validClock(workoutTime)) {
    const scheduledAt = new Date(`${today}T${workoutTime}:00-03:00`);
    const minutesUntil = (scheduledAt.getTime() - now.getTime()) / 60_000;
    if (minutesUntil > 0 && minutesUntil <= 15) {
      sent += await sendReminder(
        `workout:${email}:${today}:${workoutTime}`,
        email,
        'workout',
        { title: 'Treino em 15 minutos', body: `Seu treino de ${workout.nomeTreino || 'hoje'} começa em 15 minutos!`, url: '/?page=health' },
        now
      );
    }
  }

  return { quietHours: false, sent };
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

r.post('/check-reminders', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await checkHealthReminders(req.user!.email)) });
  } catch (error) {
    next(error);
  }
});

export default r;
