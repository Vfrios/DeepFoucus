import { google } from 'googleapis';
import crypto from 'crypto';
import { getDb } from './mongo';

// FASE 4: escopo de ESCRITA para criar/atualizar eventos.
// + Perfil/e-mail para exibir nome, email e avatar na Sidebar.
// ATENÇÃO: reautorize o Google após o deploy (/api/auth/google?token=...)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ---- OAuth: "state" assinado (HMAC) para proteger o callback contra CSRF ----
const sign = (v: string) =>
  crypto.createHmac('sha256', process.env.API_TOKEN || '').update(v).digest('hex').slice(0, 32);

export function authUrl(): string {
  const ts = Date.now().toString();
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: `${ts}.${sign(ts)}`,
  });
}

export function checkState(state: string): boolean {
  const [ts, sig] = (state || '').split('.');
  return !!ts && !!sig && sig === sign(ts) && Date.now() - Number(ts) < 10 * 60 * 1000;
}

export interface GoogleProfile {
  email: string | null;
  name: string | null;
  picture: string | null;
}

export async function saveCode(code: string): Promise<GoogleProfile> {
  const auth = oauthClient();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google não devolveu refresh_token. Revogue o acesso em myaccount.google.com/permissions e repita.'
    );
  }
  auth.setCredentials(tokens);

  // Busca perfil + email usando o access_token recém obtido
  let profile: GoogleProfile = { email: null, name: null, picture: null };
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const { data } = await oauth2.userinfo.get();
    profile = {
      email: data.email ?? null,
      name: data.name ?? null,
      picture: data.picture ?? null,
    };
  } catch (e: any) {
    // Não impede o salvamento do refresh_token se userinfo falhar
    console.warn('[google] falha ao obter userinfo:', e?.message || e);
  }

  const db = await getDb();
  await db.collection<any>('auth').updateOne(
    { _id: 'google' },
    {
      $set: {
        refresh_token: tokens.refresh_token,
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
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  color: string;
  calendar: string;
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

export async function listEvents(from: Date, days: number): Promise<CalEvent[]> {
  const cal = await authedCalendar();
  if (!cal) throw new Error('google_not_connected');

  const to = new Date(from.getTime() + days * 86400000);
  const lists = await cal.calendarList.list({ minAccessRole: 'reader' });
  const cals = (lists.data.items || []).filter((c) => c.selected !== false && c.id).slice(0, 10);

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

export async function createCalendarEvent(task: {
  texto: string;
  data?: string | null;
}): Promise<string | null> {
  try {
    const cal = await authedCalendar();
    if (!cal) return null;

    let startISO: string;
    let endISO: string;
    if (task.data && !isNaN(new Date(task.data).getTime())) {
      const start = new Date(task.data);
      startISO = start.toISOString();
      endISO = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
    } else {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
      startISO = start.toISOString();
      endISO = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
    }

    const r = await cal.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: task.texto,
        description: 'Tarefa criada pelo Wall Dashboard',
        start: { dateTime: startISO, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: endISO, timeZone: 'America/Sao_Paulo' },
      },
    });

    return r.data.id || null;
  } catch (e: any) {
    console.warn('[google] falha ao criar evento:', e?.message || e);
    return null;
  }
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
