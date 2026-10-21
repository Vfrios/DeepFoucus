import { google } from 'googleapis';
import crypto from 'crypto';
import { getDb } from './mongo';

// Escopos para listar calendários/eventos e criar/atualizar eventos.
// + Perfil/e-mail para exibir nome, email e avatar na Sidebar.
// Reautorize o Google após mudanças nos escopos (/api/auth/google?token=...)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

let calendarSyncInProgress: Promise<void> | null = null;
let lastCalendarSyncAt = 0;

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ---- OAuth: "state" assinado (HMAC) para proteger o callback contra CSRF ----
const sign = (v: string) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(v).digest('hex').slice(0, 32);

export type OAuthFlow = 'setup' | 'login';

export function authUrl(flow: OAuthFlow = 'setup'): string {
  const ts = Date.now().toString();
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: `${flow}.${ts}.${sign(`${flow}.${ts}`)}`,
  });
}

export function checkState(state: string): OAuthFlow | null {
  const [flow, ts, sig] = (state || '').split('.');
  const age = Date.now() - Number(ts);
  if (
    (flow !== 'setup' && flow !== 'login') ||
    !ts ||
    !sig ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 10 * 60 * 1000 ||
    sig !== sign(`${flow}.${ts}`)
  ) {
    return null;
  }
  return flow;
}

export interface GoogleProfile {
  email: string | null;
  name: string | null;
  picture: string | null;
}

export async function saveCode(code: string, expectedEmail?: string): Promise<GoogleProfile> {
  const auth = oauthClient();
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data } = await oauth2.userinfo.get();
  const profile: GoogleProfile = {
    email: data.email ?? null,
    name: data.name ?? null,
    picture: data.picture ?? null,
  };
  if (!profile.email || data.verified_email !== true) {
    throw new Error('Google não retornou um e-mail verificado.');
  }
  if (expectedEmail && profile.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error('google_account_not_allowed');
  }

  const db = await getDb();
  const existing = tokens.refresh_token
    ? null
    : await db.collection<any>('auth').findOne({ _id: 'google' });
  const refreshToken = tokens.refresh_token || existing?.refresh_token;
  if (!refreshToken) {
    throw new Error(
      'Google não devolveu refresh_token. Revogue o acesso em myaccount.google.com/permissions e repita.'
    );
  }

  await db.collection<any>('auth').updateOne(
    { _id: 'google' },
    {
      $set: {
        refresh_token: refreshToken,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        atualizadoEm: new Date(),
      },
    },
    { upsert: true }
  );

  return profile;
}

export async function isConnected(): Promise<boolean> {
  const db = await getDb();
  return !!(await db.collection<any>('auth').findOne({ _id: 'google' }));
}

/** Lê o perfil salvo no Mongo. Retorna nulls se ainda não conectado. */
export async function getProfile(): Promise<GoogleProfile> {
  const db = await getDb();
  const doc = await db.collection<any>('auth').findOne({ _id: 'google' });
  return {
    email: doc?.email ?? null,
    name: doc?.name ?? null,
    picture: doc?.picture ?? null,
  };
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  color: string;
  calendar: string;
}

export interface UserCalendar {
  id: string;
  summary: string;
  backgroundColor: string;
  primary: boolean;
}

/** Cliente autenticado para escrita. Retorna null se não conectado. */
async function authedCalendar() {
  const db = await getDb();
  const doc = await db.collection<any>('auth').findOne({ _id: 'google' });
  if (!doc?.refresh_token) return null;
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: doc.refresh_token });
  return google.calendar({ version: 'v3', auth });
}

export async function listCalendars(): Promise<UserCalendar[]> {
  const cal = await authedCalendar();
  if (!cal) throw new Error('google_not_connected');

  const result = await cal.calendarList.list({ minAccessRole: 'reader', maxResults: 250 });
  return (result.data.items || [])
    .filter((item) => !!item.id)
    .map((item) => ({
      id: item.id!,
      summary: item.summary || item.id!,
      backgroundColor: item.backgroundColor || '#86d7c0',
      primary: item.primary === true,
    }));
}

export async function listEvents(from: Date, days: number): Promise<CalEvent[]> {
  const cal = await authedCalendar();
  if (!cal) throw new Error('google_not_connected');

  const to = new Date(from.getTime() + days * 86400000);
  const lists = await cal.calendarList.list({ minAccessRole: 'reader' });
  const cals = (lists.data.items || []).filter((c) => c.id).slice(0, 10);

  const perCal = await Promise.all(
    cals.map(async (c) => {
      try {
        const r = await cal.events.list({
          calendarId: c.id!,
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 100,
        });
        return (r.data.items || [])
          .filter((e) => e.status !== 'cancelled')
          .map<CalEvent>((e) => ({
            id: `${c.id}:${e.id}`,
            calendarId: c.id!,
            title: e.summary || '(sem título)',
            start: e.start?.dateTime || e.start?.date || '',
            end: e.end?.dateTime || e.end?.date || '',
            allDay: !e.start?.dateTime,
            location: e.location || '',
            color: c.backgroundColor || '#86d7c0',
            calendar: c.summary || '',
          }));
      } catch {
        return [] as CalEvent[];
      }
    })
  );
  return perCal.flat().sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export interface CalendarTask {
  titulo: string;
  descricao?: string;
  inicio: string;
  fim?: string | null;
  feito?: boolean;
  calendarId?: string;
}

const calendarDateTime = (value: string) => new Date(value).toISOString();

export async function createCalendarEvent(task: CalendarTask): Promise<string | null> {
  try {
    const cal = await authedCalendar();
    if (!cal) return null;

    const start = new Date(task.inicio);
    const end = task.fim ? new Date(task.fim) : new Date(start.getTime() + 60 * 60 * 1000);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new Error('intervalo de data inválido para evento do Google Calendar');
    }

    const r = await cal.events.insert({
      calendarId: task.calendarId || 'primary',
      requestBody: {
        summary: task.feito ? `[CONCLUÍDO] ${task.titulo}` : task.titulo,
        description: task.descricao || 'Criado pelo Wall Dashboard',
        start: { dateTime: calendarDateTime(task.inicio), timeZone: 'America/Sao_Paulo' },
        end: { dateTime: calendarDateTime(end.toISOString()), timeZone: 'America/Sao_Paulo' },
      },
    });

    return r.data.id || null;
  } catch (e: any) {
    console.warn('[google] falha ao criar evento:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function updateCalendarEvent(
  eventId: string,
  task: CalendarTask,
  calendarId = 'primary'
): Promise<void> {
  try {
    const cal = await authedCalendar();
    if (!cal) return;

    const start = new Date(task.inicio);
    const end = task.fim ? new Date(task.fim) : new Date(start.getTime() + 60 * 60 * 1000);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new Error('intervalo de data inválido para evento do Google Calendar');
    }

    await cal.events.patch({
      calendarId,
      eventId,
      requestBody: {
        summary: task.feito ? `[CONCLUÍDO] ${task.titulo}` : task.titulo,
        description: task.descricao || 'Criado pelo Wall Dashboard',
        start: { dateTime: calendarDateTime(task.inicio), timeZone: 'America/Sao_Paulo' },
        end: { dateTime: calendarDateTime(end.toISOString()), timeZone: 'America/Sao_Paulo' },
      },
    });
  } catch (e: any) {
    console.warn('[google] falha ao atualizar evento:', e instanceof Error ? e.message : e);
  }
}

export async function deleteCalendarEvent(eventId: string, calendarId = 'primary'): Promise<void> {
  try {
    const cal = await authedCalendar();
    if (!cal) return;
    await cal.events.delete({ calendarId, eventId });
  } catch (e: any) {
    console.warn('[google] falha ao excluir evento:', e instanceof Error ? e.message : e);
  }
}

interface CalendarSyncEvent {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

async function carregarAlteracoesCalendario(
  cal: NonNullable<Awaited<ReturnType<typeof authedCalendar>>>,
  syncToken?: string
): Promise<{ events: CalendarSyncEvent[]; nextSyncToken?: string }> {
  const events: CalendarSyncEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const result = await cal.events.list({
      calendarId: 'primary',
      maxResults: 2500,
      showDeleted: true,
      ...(syncToken ? { syncToken } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    events.push(...(result.data.items || []));
    pageToken = result.data.nextPageToken || undefined;
    nextSyncToken = result.data.nextSyncToken || nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

/** Reconciles only Google events linked to tasks created by this app. */
export async function syncLinkedTaskEventsFromGoogle(): Promise<void> {
  if (Date.now() - lastCalendarSyncAt < 30_000) return;
  if (calendarSyncInProgress) return calendarSyncInProgress;

  calendarSyncInProgress = (async () => {
    const db = await getDb();
    const tasks = db.collection<any>('tasks');
    if (!(await tasks.countDocuments({ googleEventId: { $type: 'string' } }))) {
      lastCalendarSyncAt = Date.now();
      return;
    }

    const auth = await db.collection<any>('auth').findOne({ _id: 'google' });
    if (!auth?.refresh_token) {
      lastCalendarSyncAt = Date.now();
      return;
    }
    const cal = await authedCalendar();
    if (!cal) return;

    let changes;
    let fullSync = !auth.calendarSyncToken;
    try {
      changes = await carregarAlteracoesCalendario(cal, auth.calendarSyncToken);
    } catch (error) {
      if (!auth.calendarSyncToken || (error as { code?: number })?.code !== 410) throw error;
      fullSync = true;
      changes = await carregarAlteracoesCalendario(cal);
    }

    const eventIds = changes.events.map((event) => event.id).filter((id): id is string => !!id);
    const primaryCalendarTaskFilter = {
      $or: [{ calendarId: 'primary' }, { calendarId: { $exists: false } }],
    };
    const linked = fullSync
      ? await tasks.find({ googleEventId: { $type: 'string' }, ...primaryCalendarTaskFilter }).toArray()
      : eventIds.length
        ? await tasks.find({
            googleEventId: { $in: eventIds },
            ...primaryCalendarTaskFilter,
          }).toArray()
        : [];
    const byEventId = new Map(linked.map((task) => [task.googleEventId, task]));
    const operations = [];
    const availableEventIds = new Set(eventIds);

    for (const event of changes.events) {
      if (!event.id) continue;
      const task = byEventId.get(event.id);
      if (!task) continue;

      if (event.status === 'cancelled') {
        operations.push({
          updateOne: {
            filter: { _id: task._id, googleEventId: event.id },
            update: { $unset: { googleEventId: '' }, $set: { atualizadoEm: new Date() } },
          },
        });
        continue;
      }

      const startValue = event.start?.dateTime || event.start?.date;
      if (!startValue) continue;
      const toISO = (value: string) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00-03:00`)
          : new Date(value);
        return isNaN(date.getTime()) ? null : date.toISOString();
      };
      const inicio = toISO(startValue);
      const fimValue = event.end?.dateTime || event.end?.date;
      const fim = fimValue ? toISO(fimValue) : null;
      if (!inicio || (fim && new Date(fim) <= new Date(inicio))) continue;

      const tituloGoogle = (event.summary || '(sem título)').trim().slice(0, 200);
      const feito = /^\[CONCLUÍDO\]\s*/i.test(tituloGoogle);
      const titulo = tituloGoogle.replace(/^\[CONCLUÍDO\]\s*/i, '');
      operations.push({
        updateOne: {
          filter: { _id: task._id, googleEventId: event.id },
          update: {
            $set: {
              titulo,
              texto: titulo,
              descricao: (event.description || '').slice(0, 1000),
              inicio,
              data: inicio,
              fim,
              feito,
              atualizadoEm: new Date(),
            },
          },
        },
      });
    }

    if (fullSync) {
      for (const task of linked) {
        if (availableEventIds.has(task.googleEventId)) continue;
        operations.push({
          updateOne: {
            filter: { _id: task._id, googleEventId: task.googleEventId },
            update: { $unset: { googleEventId: '' }, $set: { atualizadoEm: new Date() } },
          },
        });
      }
    }

    if (operations.length) await tasks.bulkWrite(operations);
    if (changes.nextSyncToken) {
      await db.collection<any>('auth').updateOne(
        { _id: 'google' },
        { $set: { calendarSyncToken: changes.nextSyncToken } }
      );
    }
    lastCalendarSyncAt = Date.now();
  })().finally(() => {
    calendarSyncInProgress = null;
  });

  return calendarSyncInProgress;
}

export async function markCalendarEventDone(
  eventId: string,
  done: boolean,
  textoOriginal: string
): Promise<void> {
  try {
    const cal = await authedCalendar();
    if (!cal) return;

    const limpo = textoOriginal.replace(/^\[CONCLUÍDO\]\s*/i, '');
    const summary = done ? `[CONCLUÍDO] ${limpo}` : limpo;

    await cal.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: { summary },
    });
  } catch (e: any) {
    console.warn('[google] falha ao atualizar evento:', e?.message || e);
  }
}
