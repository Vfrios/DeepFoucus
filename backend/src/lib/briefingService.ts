import type { Db } from 'mongodb';
import cron from 'node-cron';
import { getCanvasTokenStatus } from './canvasAuth';
import { CalEvent, listEvents } from './google';
import { getDb } from './mongo';
import { getPucAgentConfig } from './pucAgentRunner';
import { getGithubConfigStatus } from './pucGithub';
import { DetailedWeather, getDetailedWeather } from './weather';
import { sendPushToAll, sendPushToUser } from '../routes/push';
import { BriefingAiCaller, BRIEFING_AI_TIMEOUT_MS, redactBriefingWithAI } from './briefingAi';
import {
  BRIEFING_TIME_ZONE,
  BriefingConfig,
  BriefingSections,
  BriefingSnapshot,
  buildBriefingPushPayload,
  buildBriefingSections,
  getDefaultBriefingConfig,
  getSaoPauloDateKey,
  isValidClock,
  RawPucAnnouncement,
  RawPucAgentRecord,
  RawPucAssignment,
  RawPucCourse,
  RawPucDeliverable,
  RawSystemAlertInputs,
  RawTaskItem,
  renderDeterministicFull,
  renderDeterministicSpeech,
  sanitizeBriefingConfig,
  shiftDateKey,
} from './briefingCore';

export const SOURCE_TIMEOUT_MS = 4_000;
const CONFIG_DOC_ID = 'briefing_config' as const;

export interface BriefingTimingsMs {
  cacheLookup: number;
  weather?: number;
  calendar?: number;
  puc?: number;
  tasks?: number;
  systemAlerts?: number;
  ai?: number;
  total: number;
}

export interface BriefingPayload {
  dateKey: string;
  speech: string;
  full: string;
  sections: BriefingSections;
  generatedAt: string;
  cached: boolean;
  aiUsed: boolean;
  aiProvider: string | null;
  aiModel: string | null;
  aiFallbackReason: string | null;
  failedSources: string[];
  timingsMs: BriefingTimingsMs;
  pushSent: boolean;
}

export interface CachedBriefingDoc {
  dateKey: string;
  speech: string;
  full: string;
  sections: BriefingSections;
  snapshot: BriefingSnapshot;
  generatedAt: string;
  aiUsed: boolean;
  aiProvider: string | null;
  aiModel: string | null;
  aiFallbackReason: string | null;
  failedSources: string[];
  timingsMs: BriefingTimingsMs;
  updatedAt: Date;
}

export interface BriefingStore {
  getConfig(): Promise<BriefingConfig>;
  saveConfig(config: BriefingConfig): Promise<BriefingConfig>;
  getBriefingByDate(dateKey: string): Promise<CachedBriefingDoc | null>;
  getLatestBriefingBefore(dateKey: string): Promise<CachedBriefingDoc | null>;
  saveBriefing(doc: CachedBriefingDoc): Promise<void>;
  pruneBriefingsBefore(minDateKey: string): Promise<void>;
  claimDailyPush(dateKey: string, now: Date): Promise<boolean>;
  releaseDailyPush(dateKey: string): Promise<void>;
  hasDailyPushBeenSent(dateKey: string): Promise<boolean>;
}

export interface BriefingDataSources {
  fetchWeather(lat?: string, lon?: string, signal?: AbortSignal, now?: Date): Promise<DetailedWeather | null>;
  fetchCalendar(now: Date): Promise<CalEvent[]>;
  fetchPuc(): Promise<{
    courses: RawPucCourse[];
    assignments: RawPucAssignment[];
    deliverables: RawPucDeliverable[];
    agentRecords: RawPucAgentRecord[];
    announcements: RawPucAnnouncement[];
  }>;
  fetchTasks(): Promise<RawTaskItem[]>;
  fetchSystemAlerts(now: Date): Promise<RawSystemAlertInputs>;
  sendPush(payload: { title: string; body: string; url: string }): Promise<{ sent: number }>;
}

export interface BriefingServiceDeps {
  store: BriefingStore;
  sources: BriefingDataSources;
  aiCaller?: BriefingAiCaller;
  sourceTimeoutMs?: number;
  aiTimeoutMs?: number;
}

function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promiseFactory(controller.signal),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`${label}_timeout`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ---------- MongoDB Store & Default Data Sources ----------

export function createMongoBriefingStore(db: Db): BriefingStore {
  return {
    async getConfig(): Promise<BriefingConfig> {
      const defaults = getDefaultBriefingConfig();
      const doc = await db.collection('briefing_config').findOne({ _id: CONFIG_DOC_ID as any });
      if (!doc) return defaults;
      return sanitizeBriefingConfig(doc, defaults);
    },
    async saveConfig(config: BriefingConfig): Promise<BriefingConfig> {
      const clean = sanitizeBriefingConfig(config, getDefaultBriefingConfig());
      await db.collection('briefing_config').updateOne(
        { _id: CONFIG_DOC_ID as any },
        { $set: { ...clean, updatedAt: new Date() } },
        { upsert: true }
      );
      return clean;
    },
    async getBriefingByDate(dateKey: string): Promise<CachedBriefingDoc | null> {
      const doc = await db.collection<CachedBriefingDoc>('briefings').findOne({ dateKey });
      return doc || null;
    },
    async getLatestBriefingBefore(dateKey: string): Promise<CachedBriefingDoc | null> {
      const doc = await db
        .collection<CachedBriefingDoc>('briefings')
        .find({ dateKey: { $lt: dateKey } })
        .sort({ dateKey: -1 })
        .limit(1)
        .next();
      return doc || null;
    },
    async saveBriefing(doc: CachedBriefingDoc): Promise<void> {
      await db.collection<CachedBriefingDoc>('briefings').updateOne(
        { dateKey: doc.dateKey },
        { $set: doc },
        { upsert: true }
      );
    },
    async pruneBriefingsBefore(minDateKey: string): Promise<void> {
      await db.collection('briefings').deleteMany({ dateKey: { $lt: minDateKey } });
    },
    async claimDailyPush(dateKey: string, now: Date): Promise<boolean> {
      try {
        await db.collection('push_reminders').insertOne({
          _id: `briefing:${dateKey}` as any,
          kind: 'morning_briefing',
          sentAt: now,
        });
        return true;
      } catch (err: any) {
        if (err?.code === 11000) return false;
        throw err;
      }
    },
    async releaseDailyPush(dateKey: string): Promise<void> {
      await db.collection('push_reminders').deleteOne({ _id: `briefing:${dateKey}` as any });
    },
    async hasDailyPushBeenSent(dateKey: string): Promise<boolean> {
      const doc = await db
        .collection('push_reminders')
        .findOne({ _id: `briefing:${dateKey}` as any }, { projection: { _id: 1 } });
      return Boolean(doc);
    },
  };
}

export function createDefaultBriefingSources(db: Db): BriefingDataSources {
  return {
    async fetchWeather(lat?: string, lon?: string, signal?: AbortSignal, now?: Date) {
      return getDetailedWeather(lat, lon, { signal, now });
    },
    async fetchCalendar(now: Date) {
      const todayKey = getSaoPauloDateKey(now);
      const dayStart = new Date(`${todayKey}T00:00:00.000-03:00`);
      return listEvents(dayStart, 1);
    },
    async fetchPuc() {
      const courses = (await db
        .collection('canvas_courses')
        .find(
          { active: true, hidden: { $ne: true } },
          { projection: { canvas_id: 1, name: 1, course_code: 1, aliases: 1, auto_aliases: 1, hidden: 1, active: 1 } }
        )
        .toArray()) as unknown as RawPucCourse[];

      const visibleIds = courses.map((c) => Number(c.canvas_id));
      if (visibleIds.length === 0) {
        return { courses: [], assignments: [], deliverables: [], agentRecords: [], announcements: [] };
      }

      const [assignments, deliverables, agentRecords, announcements] = await Promise.all([
        db
          .collection('canvas_assignments')
          .find(
            { course_id: { $in: visibleIds } },
            {
              projection: {
                course_id: 1,
                canvas_id: 1,
                course_name: 1,
                name: 1,
                due_at: 1,
                lock_at: 1,
                locked_for_user: 1,
                points_possible: 1,
                submission_types: 1,
                workflow_state: 1,
                submitted_at: 1,
                score: 1,
                grade: 1,
                late: 1,
                missing: 1,
                excused: 1,
                statement_hash: 1,
                first_seen_at: 1,
                updated_at: 1,
              },
            }
          )
          .toArray() as unknown as Promise<RawPucAssignment[]>,
        db
          .collection('puc_deliverables')
          .find(
            { course_id: { $in: visibleIds } },
            { projection: { course_id: 1, assignment_id: 1, status: 1, statement_changed: 1, updated_at: 1 } }
          )
          .toArray() as unknown as Promise<RawPucDeliverable[]>,
        db
          .collection('puc_agent_records')
          .find(
            { course_id: { $in: visibleIds } },
            { projection: { course_id: 1, assignment_id: 1, status: 1, reason: 1, error: 1, updated_at: 1 } }
          )
          .toArray() as unknown as Promise<RawPucAgentRecord[]>,
        db
          .collection('canvas_announcements')
          .find(
            { course_id: { $in: visibleIds }, read: { $ne: true } },
            { projection: { course_id: 1, canvas_id: 1, course_name: 1, title: 1, message: 1, posted_at: 1, read: 1 } }
          )
          .sort({ posted_at: -1 })
          .limit(15)
          .toArray() as unknown as Promise<RawPucAnnouncement[]>,
      ]);

      return { courses, assignments, deliverables, agentRecords, announcements };
    },
    async fetchTasks() {
      const rows = await db
        .collection('tasks')
        .find(
          { feito: { $ne: true } },
          { projection: { _id: 1, titulo: 1, texto: 1, inicio: 1, data: 1, feito: 1, googleEventId: 1 } }
        )
        .limit(60)
        .toArray();
      return rows.map((r: any) => ({
        _id: String(r._id),
        titulo: r.titulo,
        texto: r.texto,
        inicio: r.inicio,
        data: r.data,
        feito: Boolean(r.feito),
        googleEventId: r.googleEventId ?? null,
      }));
    },
    async fetchSystemAlerts(now: Date): Promise<RawSystemAlertInputs> {
      const [canvasToken, githubToken, lastCanvasSync, pucAgent] = await Promise.all([
        getCanvasTokenStatus(db, now).catch(() => null),
        getGithubConfigStatus(db, now).catch(() => null),
        db
          .collection('canvas_sync_log')
          .find({}, { projection: { status: 1, error: 1, finished_at: 1, started_at: 1 } })
          .sort({ started_at: -1 })
          .limit(1)
          .next()
          .catch(() => null),
        getPucAgentConfig(db).catch(() => null),
      ]);

      return {
        canvasToken,
        githubToken,
        lastCanvasSync: lastCanvasSync as any,
        pucAgent: pucAgent ? { enabled: pucAgent.enabled, paused: pucAgent.paused } : null,
      };
    },
    async sendPush(payload) {
      const ownerEmail = (process.env.EMAIL_VITOR || '').trim();
      if (ownerEmail) {
        const res = await sendPushToUser(ownerEmail, payload);
        if (res.sent > 0) return { sent: res.sent };
      }
      const res = await sendPushToAll(payload);
      return { sent: res.sent };
    },
  };
}

// ---------- Main Orchestrator ----------

export async function generateOrGetBriefing(
  options: {
    lat?: string;
    lon?: string;
    refresh?: boolean;
    now?: Date;
    triggerPush?: boolean;
  },
  deps: BriefingServiceDeps
): Promise<BriefingPayload> {
  const tTotalStart = Date.now();
  const now = options.now ?? new Date();
  const todayKey = getSaoPauloDateKey(now);
  const sourceTimeoutMs = deps.sourceTimeoutMs ?? SOURCE_TIMEOUT_MS;
  const aiTimeoutMs = deps.aiTimeoutMs ?? BRIEFING_AI_TIMEOUT_MS;

  const timingsMs: BriefingTimingsMs = {
    cacheLookup: 0,
    total: 0,
  };

  // 1. Config + Cache lookup
  const tCache = Date.now();
  const [config, cachedDoc] = await Promise.all([
    deps.store.getConfig(),
    options.refresh ? Promise.resolve(null) : deps.store.getBriefingByDate(todayKey),
  ]);
  timingsMs.cacheLookup = Date.now() - tCache;

  if (cachedDoc && !options.refresh) {
    let pushSent = false;
    if (options.triggerPush !== false && config.pushEnabled && !config.pushScheduleTime) {
      pushSent = await trySendDailyBriefingPush(cachedDoc.sections, todayKey, now, deps);
    }
    timingsMs.total = Date.now() - tTotalStart;
    return {
      dateKey: cachedDoc.dateKey,
      speech: cachedDoc.speech,
      full: cachedDoc.full,
      sections: cachedDoc.sections,
      generatedAt: cachedDoc.generatedAt,
      cached: true,
      aiUsed: cachedDoc.aiUsed,
      aiProvider: cachedDoc.aiProvider,
      aiModel: cachedDoc.aiModel,
      aiFallbackReason: cachedDoc.aiFallbackReason,
      failedSources: cachedDoc.failedSources,
      timingsMs,
      pushSent,
    };
  }

  // 2. Load previous day snapshot for anti-repetition
  const prevDoc = await deps.store.getLatestBriefingBefore(todayKey).catch(() => null);
  const previousSnapshot = prevDoc?.snapshot ?? null;

  // 3. Collect all sources in parallel with 4s timeout each
  const failedSources: string[] = [];

  const timedSource = async <T>(
    name: keyof BriefingTimingsMs & string,
    enabled: boolean,
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T | null> => {
    if (!enabled) return null;
    const t0 = Date.now();
    try {
      const value = await withTimeout(fn, sourceTimeoutMs, name);
      timingsMs[name] = Date.now() - t0;
      return value;
    } catch (err) {
      timingsMs[name] = Date.now() - t0;
      failedSources.push(name);
      console.warn(
        `[briefing] fonte "${name}" falhou em ${timingsMs[name]}ms:`,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  };

  const [weatherRes, calendarRes, pucRes, tasksRes, alertsRes] = await Promise.allSettled([
    timedSource('weather', config.sections.weather, async (signal) => {
      const w = await deps.sources.fetchWeather(options.lat, options.lon, signal, now);
      if (!w) throw new Error('weather_unavailable');
      return w;
    }),
    timedSource('calendar', config.sections.calendar, async () => deps.sources.fetchCalendar(now)),
    timedSource('puc', config.sections.pucDeliveries || config.sections.pucNews, async () =>
      deps.sources.fetchPuc()
    ),
    timedSource('tasks', config.sections.tasks, async () => deps.sources.fetchTasks()),
    timedSource('systemAlerts', config.sections.systemAlerts, async () =>
      deps.sources.fetchSystemAlerts(now)
    ),
  ]);

  const weather = weatherRes.status === 'fulfilled' ? weatherRes.value : null;
  const calendarEvents = calendarRes.status === 'fulfilled' && calendarRes.value ? calendarRes.value : [];
  const pucData =
    pucRes.status === 'fulfilled' && pucRes.value
      ? pucRes.value
      : { courses: [], assignments: [], deliverables: [], agentRecords: [], announcements: [] };
  const tasks = tasksRes.status === 'fulfilled' && tasksRes.value ? tasksRes.value : [];
  const systemAlerts = alertsRes.status === 'fulfilled' ? alertsRes.value : null;

  // 4. Deterministic filtering, deduplication, anti-repetition & prioritization
  const { sections, snapshot } = buildBriefingSections({
    now,
    config,
    previousSnapshot,
    weather,
    calendarEvents,
    pucCourses: pucData.courses,
    pucAssignments: pucData.assignments,
    pucDeliverables: pucData.deliverables,
    pucAgentRecords: pucData.agentRecords,
    pucAnnouncements: pucData.announcements,
    tasks,
    systemAlerts,
    failedSources,
  });

  // 5. AI redaction (strict 6s timeout, tries Groq -> Gemini -> OpenRouter)
  const tAi = Date.now();
  const aiResult = await redactBriefingWithAI(sections, {
    timeoutMs: aiTimeoutMs,
    caller: deps.aiCaller,
  });
  timingsMs.ai = Date.now() - tAi;

  const aiUnavailableNotice = !aiResult.usedAi;
  const speech =
    aiResult.usedAi && aiResult.speech
      ? aiResult.speech
      : renderDeterministicSpeech(sections, { aiUnavailableNotice });
  const full =
    aiResult.usedAi && aiResult.full
      ? aiResult.full
      : renderDeterministicFull(sections, { aiUnavailableNotice });

  const generatedAt = now.toISOString();
  timingsMs.total = Date.now() - tTotalStart;

  // 6. Persist today's briefing in Mongo and prune old records (keep today + yesterday)
  const docToSave: CachedBriefingDoc = {
    dateKey: todayKey,
    speech,
    full,
    sections,
    snapshot,
    generatedAt,
    aiUsed: aiResult.usedAi,
    aiProvider: aiResult.provider,
    aiModel: aiResult.model,
    aiFallbackReason: aiResult.fallbackReason,
    failedSources,
    timingsMs,
    updatedAt: now,
  };

  try {
    await deps.store.saveBriefing(docToSave);
    const keepFrom = shiftDateKey(todayKey, -1);
    await deps.store.pruneBriefingsBefore(keepFrom);
  } catch (err) {
    console.warn('[briefing] falha ao salvar cache no Mongo:', err instanceof Error ? err.message : String(err));
  }

  // 7. Single daily Web Push (if enabled and set to trigger on first call)
  let pushSent = false;
  if (options.triggerPush !== false && config.pushEnabled && !config.pushScheduleTime) {
    pushSent = await trySendDailyBriefingPush(sections, todayKey, now, deps);
  }

  console.log(
    `[briefing] date=${todayKey} cached=false ai=${aiResult.usedAi ? aiResult.provider : 'fallback'} failed=[${failedSources.join(',')}] timings=${JSON.stringify(timingsMs)}`
  );

  return {
    dateKey: todayKey,
    speech,
    full,
    sections,
    generatedAt,
    cached: false,
    aiUsed: aiResult.usedAi,
    aiProvider: aiResult.provider,
    aiModel: aiResult.model,
    aiFallbackReason: aiResult.fallbackReason,
    failedSources,
    timingsMs,
    pushSent,
  };
}

export async function trySendDailyBriefingPush(
  sections: BriefingSections,
  dateKey: string,
  now: Date,
  deps: BriefingServiceDeps
): Promise<boolean> {
  const claimed = await deps.store.claimDailyPush(dateKey, now).catch(() => false);
  if (!claimed) return false;

  const payload = buildBriefingPushPayload(sections);
  try {
    const res = await deps.sources.sendPush(payload);
    if (res.sent === 0) {
      await deps.store.releaseDailyPush(dateKey).catch(() => undefined);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[briefing/push] falha ao enviar push:', err instanceof Error ? err.message : String(err));
    await deps.store.releaseDailyPush(dateKey).catch(() => undefined);
    return false;
  }
}

export async function getDefaultBriefingDeps(): Promise<BriefingServiceDeps> {
  const db = await getDb();
  return {
    store: createMongoBriefingStore(db),
    sources: createDefaultBriefingSources(db),
  };
}

// ---------- Optional Scheduled Morning Push Job ----------

function localClock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BRIEFING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export async function runScheduledBriefingPushCheck(
  now = new Date(),
  depsOverride?: BriefingServiceDeps
): Promise<boolean> {
  const deps = depsOverride ?? (await getDefaultBriefingDeps());
  const config = await deps.store.getConfig();
  if (!config.pushEnabled || !isValidClock(config.pushScheduleTime)) return false;

  const todayKey = getSaoPauloDateKey(now);
  if (localClock(now) < config.pushScheduleTime) return false;
  if (await deps.store.hasDailyPushBeenSent(todayKey)) return false;

  const briefing = await generateOrGetBriefing(
    { now, triggerPush: false },
    deps
  );
  return trySendDailyBriefingPush(briefing.sections, todayKey, now, deps);
}

export function startBriefingPushScheduler(): void {
  try {
    cron.schedule(
      '* * * * *',
      () => {
        runScheduledBriefingPushCheck().catch((err) => {
          console.warn('[briefing/cron] erro:', err instanceof Error ? err.message : String(err));
        });
      },
      { timezone: BRIEFING_TIME_ZONE, noOverlap: true }
    );
  } catch (err) {
    console.error('[briefing/cron] falha ao agendar:', err instanceof Error ? err.message : String(err));
  }
}
