import { ObjectId } from 'mongodb';
import webpush from 'web-push';
import { getDb } from '../lib/mongo';
import { authedCalendar } from '../lib/google';
import { agentLog } from '../agents/log';
import { AgentTool } from '../agents/core';

export const dayKey = (date: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(date);
export const PUC_CONTEXT = 'PUC: segunda e terça 19:00–22:30; quarta 17:10–20:40; quinta 17:10–18:40 e 20:50–22:30. Fuso America/Sao_Paulo. Seja conservador: só mova treino se houver prova confirmada próxima. Nunca ocupe aulas ou compromissos existentes.';
const midnight = (day: string) => new Date(`${day}T00:00:00-03:00`);
const timestamp = (value: unknown): Date => {
  if (typeof value !== 'string' || !/T.*(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('Data ISO com fuso obrigatória');
  return new Date(value);
};
export function pucIntervals(day: string) {
  const weekday = midnight(day).getUTCDay();
  const hours: Record<number, string[][]> = { 1: [['19:00', '22:30']], 2: [['19:00', '22:30']], 3: [['17:10', '20:40']], 4: [['17:10', '18:40'], ['20:50', '22:30']] };
  return (hours[weekday] || []).map(([a,b]) => ({ start: `${day}T${a}:00-03:00`, end: `${day}T${b}:00-03:00` }));
}

// Unlike the UI reader, this reader fails closed and follows every page.
async function calendarEvents(day: string) {
  const cal = await authedCalendar();
  if (!cal) throw Error('Google Calendar não conectado');
  const events: Array<{ id: string; calendarId: string; title: string; start: string; end: string }> = [];
  let pageToken: string | undefined;
  do {
    const calendars = await cal.calendarList.list({ pageToken }, { timeout: 15000, retry: false });
    for (const calendar of calendars.data.items || []) {
      if (!calendar.id) continue;
      let eventToken: string | undefined;
      do {
        const result = await cal.events.list({ calendarId: calendar.id, pageToken: eventToken, singleEvents: true, timeMin: midnight(day).toISOString(), timeMax: new Date(+midnight(day) + 86400000).toISOString(), maxResults: 2500 }, { timeout: 15000, retry: false });
        for (const e of result.data.items || []) {
          if (e.status === 'cancelled' || e.transparency === 'transparent') continue;
          const start = e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00-03:00` : '');
          const end = e.end?.dateTime || (e.end?.date ? `${e.end.date}T00:00:00-03:00` : '');
          if (!start || !end) throw Error('Evento sem intervalo');
          events.push({ id: e.id!, calendarId: calendar.id, title: e.summary || '', start, end });
        }
        eventToken = result.data.nextPageToken || undefined;
      } while (eventToken);
    }
    pageToken = calendars.data.nextPageToken || undefined;
  } while (pageToken);
  return events;
}

export function createAgentServices(email: string, deps: { db: typeof getDb; events: typeof calendarEvents; now: () => Date; log: typeof agentLog; calendar?: typeof authedCalendar } = { db: getDb, events: calendarEvents, now: () => new Date(), log: agentLog }) {
  if (!email) throw Error('Email do proprietário obrigatório');
  let workoutAttempted = false;
  let studyAttempts = 0;
  let pushAttempted = false;
  const safe = <A extends unknown[], R>(action: string, fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    try { return await fn(...args); }
    catch (error) { await deps.log({ action, email, error: String(error) }); throw error; }
  };
  const getUpcomingExams = safe('getUpcomingExams', async () => {
    const rows = await (await deps.db()).collection('puc_events').find({ $or: [{ email }, { email: { $exists: false } }] }).toArray();
    const now = deps.now();
    return rows.filter(e => {
      const kind = String(e.tipo ?? e.type ?? '').toLowerCase();
      const raw = e.inicio ?? e.start ?? e.data ?? e.date;
      const dateOnly = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw);
      const date = dateOnly ? midnight(raw) : new Date(raw);
      return ['prova', 'exam', 'exame'].includes(kind) && +date >= (dateOnly ? +midnight(dayKey(now)) : +now) && +date < +now + 14 * 86400000;
    });
  });
  const getTomorrowEvents = safe('getTomorrowEvents', async () => {
    const day = dayKey(new Date(+deps.now() + 86400000));
    return { date: day, events: await deps.events(day), workouts: await (await deps.db()).collection('workouts').find({ email, agendadoPara: { $gte: midnight(day), $lt: new Date(+midnight(day) + 86400000) } }).toArray() };
  });
  const findFreeSlots = safe('findFreeSlots', async (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+midnight(date)) || dayKey(midnight(date)) !== date) throw Error('Dia inválido');
    const tasks = await (await deps.db()).collection('tasks').find({ feito: { $ne: true }, inicio: { $type: 'string' } }).toArray();
    const occupied = [...await deps.events(date), ...pucIntervals(date), ...tasks.map(t => ({ start: t.inicio, end: t.fim || new Date(Date.parse(t.inicio) + 3600000).toISOString() }))];
    const slots: Array<{ start: string; end: string }> = [];
    for (let start = +midnight(date) + 7 * 3600000; start + 3600000 <= +midnight(date) + 23 * 3600000; start += 1800000) {
      const end = start + 3600000;
      if (start > +deps.now() && !occupied.some(e => Date.parse(e.start) < end && Date.parse(e.end) > start)) slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
    return slots;
  });
  const checkSlot = async (start: Date, end: Date) => {
    if (+end - +start !== 3600000 || !(await findFreeSlots(dayKey(start))).some(s => +new Date(s.start) === +start)) throw Error('Escolha um bloco livre de uma hora retornado por findFreeSlots');
  };
  const createStudyTask = safe('createStudyTask', async (title: string, start: string, end: string) => {
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw Error('Título inválido');
    const a = timestamp(start), b = timestamp(end);
    const tasks = (await deps.db()).collection('tasks');
    const key = `tutor:${email}:${a.toISOString()}`;
    const existing = await tasks.findOne({ agentKey: key });
    if (existing) return { id: String(existing._id), existing: true };
    if (!(await getUpcomingExams()).length) throw Error('Sem prova próxima: estudo automático não criado');
    if (studyAttempts >= 2) throw Error('Limite de dois blocos por execução');
    await checkSlot(a,b);
    studyAttempts++;
    const result = await tasks.insertOne({ agentKey: key, email, titulo: title.trim(), texto: title.trim(), descricao: 'Bloco planejado pelo Tutor', tipo: 'estudo', inicio: a.toISOString(), data: a.toISOString(), fim: b.toISOString(), feito: false, ordem: Date.now(), criadoEm: deps.now() });
    return { id: String(result.insertedId) };
  });
  const moveWorkout = safe('moveWorkout', async (id: string, newDate: string) => {
    if (!ObjectId.isValid(id)) throw Error('ID de treino inválido');
    const start = timestamp(newDate), end = new Date(+start + 3600000);
    if (!(await getUpcomingExams()).length) throw Error('Sem prova próxima: treino preservado');
    const db = await deps.db();
    const workout = await db.collection('workouts').findOne({ _id: new ObjectId(id), email });
    if (!workout?.calendarEventId || !workout.agendadoPara) throw Error('Treino sem evento confirmado');
    if (workout.agentMovedAt) throw Error('Treino já reagendado por agente');
    if (+new Date(workout.agendadoPara) <= +deps.now()) throw Error('Treino passado não pode ser movido');
    await checkSlot(start,end);
    if (workoutAttempted) throw Error('Limite de um reagendamento por execução');
    const cal = await (deps.calendar ?? authedCalendar)();
    if (!cal) throw Error('Google não conectado');
    const event = await cal.events.get({ calendarId: 'primary', eventId: workout.calendarEventId }, { timeout: 15000, retry: false });
    if (event.data.recurrence?.length || !event.data.start?.dateTime || !event.data.end?.dateTime || Date.parse(event.data.end.dateTime) - Date.parse(event.data.start.dateTime) !== 3600000) throw Error('Somente treinos únicos de uma hora podem ser movidos automaticamente');
    if (Date.parse(event.data.start.dateTime) !== +new Date(workout.agendadoPara)) throw Error('Evento alterado externamente: reagendamento cancelado');
    workoutAttempted = true; // An ambiguous network result must never cause a second mutation.
    await cal.events.patch({ calendarId: 'primary', eventId: workout.calendarEventId, requestBody: { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } } }, { timeout: 15000, retry: false, headers: { 'If-Match': event.data.etag! } });
    // Keep the recurring workout plan intact; record the one-off override used by the health scheduler.
    await db.collection('workouts').updateOne({ _id: workout._id, email }, { $set: { agendadoPara: start, agentOriginalDate: workout.agendadoPara, agentMovedAt: deps.now() } });
    return { id, start: start.toISOString(), end: end.toISOString() };
  });
  const sendPush = safe('sendPush', async (message: string) => {
    if (typeof message !== 'string' || !message.trim() || message.length > 500) throw Error('Mensagem inválida');
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw Error('VAPID não configurado');
    if (pushAttempted) throw Error('Limite de uma notificação por execução');
    pushAttempted = true;
    const subscriptions = await (await deps.db()).collection('subscriptions').find({ email }).toArray();
    for (const subscription of subscriptions) await webpush.sendNotification(subscription.subscription, JSON.stringify({ title: 'LOSAI', body: message }), { timeout: 15000 });
    return { sent: subscriptions.length };
  });
  const logDecision = safe('logDecision', async (thought: string, action: string) => { await deps.log({ email, summary: String(thought).slice(0,1000), action }); return { ok: true }; });
  return { getTomorrowEvents, getUpcomingExams, moveWorkout, findFreeSlots, createStudyTask, sendPush, logDecision };
}

export function agentTools(services: ReturnType<typeof createAgentServices>): AgentTool[] {
  const args: Record<keyof typeof services, string[]> = { getTomorrowEvents: [], getUpcomingExams: [], moveWorkout: ['id','newDate'], findFreeSlots: ['date'], createStudyTask: ['title','start','end'], sendPush: ['message'], logDecision: ['thought','action'] };
  return (Object.keys(args) as Array<keyof typeof services>).map(name => ({ name, description: name === 'getTomorrowEvents' ? 'Eventos e IDs dos treinos de amanhã' : name === 'getUpcomingExams' ? 'Provas confirmadas dos próximos 14 dias' : name, parameters: { type: 'object', properties: Object.fromEntries(args[name].map(key => [key, { type: 'string' }])), required: args[name], additionalProperties: false }, execute: async input => {
    if (args[name].some(key => typeof input[key] !== 'string') || Object.keys(input).some(key => !args[name].includes(key))) throw Error('Argumentos inválidos');
    return (services[name] as (...values: string[]) => Promise<unknown>)(...args[name].map(key => input[key] as string));
  } }));
}
