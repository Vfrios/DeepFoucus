import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BriefingConfig,
  BriefingRawInput,
  buildBriefingPushPayload,
  buildBriefingSections,
  DEFAULT_BRIEFING_CONFIG,
  getSaoPauloDateKey,
  renderDeterministicFull,
  renderDeterministicSpeech,
  validateBriefingText,
} from '../backend/src/lib/briefingCore';
import { redactBriefingWithAI } from '../backend/src/lib/briefingAi';
import {
  BriefingDataSources,
  BriefingServiceDeps,
  BriefingStore,
  CachedBriefingDoc,
  generateOrGetBriefing,
} from '../backend/src/lib/briefingService';

function baseConfig(overrides: Partial<BriefingConfig> = {}): BriefingConfig {
  return {
    ...DEFAULT_BRIEFING_CONFIG,
    sections: { ...DEFAULT_BRIEFING_CONFIG.sections, ...(overrides.sections || {}) },
    ...overrides,
  };
}

function baseInput(overrides: Partial<BriefingRawInput> = {}): BriefingRawInput {
  return {
    now: new Date('2026-11-26T10:30:00.000Z'), // 07:30 BRT (Quinta, 26 de novembro)
    config: baseConfig(),
    previousSnapshot: null,
    weather: null,
    calendarEvents: [],
    pucCourses: [],
    pucAssignments: [],
    pucDeliverables: [],
    pucAgentRecords: [],
    pucAnnouncements: [],
    tasks: [],
    systemAlerts: null,
    failedSources: [],
    ...overrides,
  };
}

function createMemoryDeps(overrides: {
  config?: Partial<BriefingConfig>;
  sources?: Partial<BriefingDataSources>;
  aiCaller?: BriefingServiceDeps['aiCaller'];
  sourceTimeoutMs?: number;
  aiTimeoutMs?: number;
} = {}) {
  let config = baseConfig(overrides.config);
  const docs = new Map<string, CachedBriefingDoc>();
  const pushedDates = new Set<string>();
  const sentPushes: Array<{ title: string; body: string; url: string }> = [];
  let calendarCalls = 0;

  const store: BriefingStore = {
    async getConfig() {
      return config;
    },
    async saveConfig(next) {
      config = next;
      return config;
    },
    async getBriefingByDate(dateKey) {
      return docs.get(dateKey) ?? null;
    },
    async getLatestBriefingBefore(dateKey) {
      const prevKeys = Array.from(docs.keys())
        .filter((k) => k < dateKey)
        .sort()
        .reverse();
      return prevKeys.length ? docs.get(prevKeys[0])! : null;
    },
    async saveBriefing(doc) {
      docs.set(doc.dateKey, doc);
    },
    async pruneBriefingsBefore(minDateKey) {
      for (const k of Array.from(docs.keys())) {
        if (k < minDateKey) docs.delete(k);
      }
    },
    async claimDailyPush(dateKey) {
      if (pushedDates.has(dateKey)) return false;
      pushedDates.add(dateKey);
      return true;
    },
    async releaseDailyPush(dateKey) {
      pushedDates.delete(dateKey);
    },
    async hasDailyPushBeenSent(dateKey) {
      return pushedDates.has(dateKey);
    },
  };

  const sources: BriefingDataSources = {
    async fetchWeather() {
      return {
        location: 'Belo Horizonte',
        temperatureC: 21,
        minC: 17,
        maxC: 27,
        description: 'parcialmente nublado',
        rainChance: { manha: 10, tarde: 65, noite: 20 },
        maxRainChance: 65,
        windKmh: 15,
        windRelevant: false,
        needsUmbrella: true,
        needsJacket: false,
        provider: 'open-meteo',
      };
    },
    async fetchCalendar() {
      calendarCalls += 1;
      return [
        {
          id: 'primary:ev1',
          calendarId: 'primary',
          title: 'Reunião de alinhamento',
          start: '2026-11-26T14:00:00.000-03:00',
          end: '2026-11-26T15:00:00.000-03:00',
          allDay: false,
          location: 'Sala 3',
          color: '#86d7c0',
          calendar: 'Principal',
        },
      ];
    },
    async fetchPuc() {
      return {
        courses: [{ canvas_id: 1, name: 'Interação Humano-Computador - PUC' }],
        assignments: [
          {
            course_id: 1,
            canvas_id: 101,
            name: 'Protótipo de Alta Fidelidade',
            due_at: '2026-11-26T23:59:00.000-03:00',
            points_possible: 15,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
          },
        ],
        deliverables: [],
        agentRecords: [],
        announcements: [],
      };
    },
    async fetchTasks() {
      return [];
    },
    async fetchSystemAlerts() {
      return {};
    },
    async sendPush(payload) {
      sentPushes.push(payload);
      return { sent: 1 };
    },
    ...(overrides.sources || {}),
  };

  const deps: BriefingServiceDeps = {
    store,
    sources,
    aiCaller: overrides.aiCaller,
    sourceTimeoutMs: overrides.sourceTimeoutMs ?? 4_000,
    aiTimeoutMs: overrides.aiTimeoutMs ?? 6_000,
  };

  return { deps, sentPushes, getCalendarCalls: () => calendarCalls, docs };
}

describe('Morning Briefing — Core, Deduplication, Anti-Repetition & Service', () => {
  it('deduplicates same assignment between Calendar and PUC and keeps each PUC item in highest-priority section only', () => {
    const { sections } = buildBriefingSections(
      baseInput({
        pucCourses: [{ canvas_id: 1, name: 'Interação Humano-Computador - PUC', aliases: ['IHC'] }],
        pucAssignments: [
          {
            course_id: 1,
            canvas_id: 10,
            name: 'Entrega Protótipo IHC',
            due_at: '2026-11-26T19:00:00.000-03:00',
            points_possible: 10,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
            first_seen_at: '2026-11-26T06:00:00.000-03:00',
          },
        ],
        pucDeliverables: [
          {
            course_id: 1,
            assignment_id: 10,
            status: 'entrega_gerada',
          },
        ],
        calendarEvents: [
          {
            id: 'primary:dup-ihc',
            calendarId: 'primary',
            title: 'Entrega Protótipo IHC',
            start: '2026-11-26T19:00:00.000-03:00',
            end: '2026-11-26T20:00:00.000-03:00',
            allDay: false,
            location: '',
            color: '#fff',
            calendar: 'PUC',
          },
          {
            id: 'primary:real-meeting',
            calendarId: 'primary',
            title: 'Dentista',
            start: '2026-11-26T10:00:00.000-03:00',
            end: '2026-11-26T11:00:00.000-03:00',
            allDay: false,
            location: 'Centro',
            color: '#fff',
            calendar: 'Pessoal',
          },
        ],
      })
    );

    // Deve aparecer em venceHoje (maior prioridade), e NÃO duplicar em prontasParaEnviar nem novidades
    assert.equal(sections.puc?.venceHoje.length, 1);
    assert.equal(sections.puc?.totalProntasParaEnviar, 0);
    assert.equal(sections.puc?.novidades.length, 0);

    // No Calendar, o evento duplicado da PUC deve ter sido mesclado/removido, sobrando só Dentista
    assert.equal(sections.agenda?.eventos.length, 1);
    assert.equal(sections.agenda?.eventos[0].titulo, 'Dentista');
  });

  it('prevents repeating yesterday news and announcements, and re-surfaces pending item only when state changes', () => {
    const day1 = new Date('2026-11-25T10:30:00.000Z'); // 25/11 07:30 BRT
    const day2 = new Date('2026-11-26T10:30:00.000Z'); // 26/11 07:30 BRT

    const courses = [{ canvas_id: 1, name: 'Engenharia de Software - PUC', aliases: ['ES'] }];
    const farDue = '2026-12-10T23:59:00.000-03:00';

    const run1 = buildBriefingSections(
      baseInput({
        now: day1,
        pucCourses: courses,
        pucAssignments: [
          {
            course_id: 1,
            canvas_id: 20,
            name: 'Relatório Final',
            due_at: farDue,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
            first_seen_at: '2026-11-25T05:00:00.000-03:00',
          },
        ],
        pucAnnouncements: [
          {
            course_id: 1,
            canvas_id: 900,
            title: 'Mudança de sala',
            message: '<p>A aula será no laboratório 4.</p>',
            posted_at: '2026-11-25T06:00:00.000-03:00',
            read: false,
          },
        ],
      })
    );

    assert.equal(run1.sections.puc?.novidades.length, 2); // trabalho novo + aviso novo

    // Dia seguinte: mesmo trabalho pendente distante e mesmo aviso não lido -> não deve repetir
    const run2 = buildBriefingSections(
      baseInput({
        now: day2,
        previousSnapshot: run1.snapshot,
        pucCourses: courses,
        pucAssignments: [
          {
            course_id: 1,
            canvas_id: 20,
            name: 'Relatório Final',
            due_at: farDue,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
            first_seen_at: '2026-11-25T05:00:00.000-03:00',
          },
        ],
        pucAnnouncements: [
          {
            course_id: 1,
            canvas_id: 900,
            title: 'Mudança de sala',
            message: '<p>A aula será no laboratório 4.</p>',
            posted_at: '2026-11-25T06:00:00.000-03:00',
            read: false,
          },
        ],
      })
    );

    assert.equal(run2.sections.puc, null);

    // Se no dia 2 sair uma nota para aquele trabalho, aí sim aparece como novidade
    const run2WithGrade = buildBriefingSections(
      baseInput({
        now: day2,
        previousSnapshot: run1.snapshot,
        pucCourses: courses,
        pucAssignments: [
          {
            course_id: 1,
            canvas_id: 20,
            name: 'Relatório Final',
            due_at: farDue,
            points_possible: 20,
            score: 18,
            submission_types: ['online_upload'],
            workflow_state: 'graded',
          },
        ],
      })
    );

    assert.equal(run2WithGrade.sections.puc?.novidades.length, 1);
    assert.equal(run2WithGrade.sections.puc?.novidades[0].tipo, 'nota_nova');
  });

  it('omits empty sections completely without filler text', () => {
    const { sections } = buildBriefingSections(baseInput());
    assert.equal(sections.clima, null);
    assert.equal(sections.agenda, null);
    assert.equal(sections.puc, null);
    assert.equal(sections.tarefas, null);
    assert.equal(sections.alertasSistema.length, 0);
    assert.equal(sections.focoDoDia.length, 0);

    const speech = renderDeterministicSpeech(sections);
    assert.match(speech, /^Bom dia\. Quinta, 26 de novembro\.$/);
  });

  it('enforces maxItemsPerSection and renders "e mais N" for overflow', () => {
    const assignments = Array.from({ length: 7 }, (_, i) => ({
      course_id: 1,
      canvas_id: 100 + i,
      name: `Atividade ${i + 1}`,
      due_at: `2026-11-26T${String(12 + i).padStart(2, '0')}:00:00.000-03:00`,
      submission_types: ['online_upload'],
      workflow_state: 'unsubmitted',
    }));

    const { sections } = buildBriefingSections(
      baseInput({
        config: baseConfig({ maxItemsPerSection: 5 }),
        pucCourses: [{ canvas_id: 1, name: 'Algoritmos - PUC', aliases: ['AED'] }],
        pucAssignments: assignments,
      })
    );

    assert.equal(sections.puc?.venceHoje.length, 5);
    assert.equal(sections.puc?.overflowVenceHoje, 2);

    const full = renderDeterministicFull(sections);
    assert.match(full, /e mais 2/);
  });

  it('selects at most 3 deterministic focus items prioritized by urgency, points, and ready-to-submit', () => {
    const { sections } = buildBriefingSections(
      baseInput({
        pucCourses: [{ canvas_id: 1, name: 'Sistemas Operacionais - PUC', aliases: ['SO'] }],
        pucAssignments: [
          {
            course_id: 1,
            canvas_id: 1,
            name: 'Lista Atrasada',
            due_at: '2026-11-25T18:00:00.000-03:00',
            points_possible: 5,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
          },
          {
            course_id: 1,
            canvas_id: 2,
            name: 'Trabalho Hoje Alto Peso',
            due_at: '2026-11-26T20:00:00.000-03:00',
            points_possible: 20,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
          },
          {
            course_id: 1,
            canvas_id: 3,
            name: 'Trabalho Pronto',
            due_at: '2026-11-29T20:00:00.000-03:00',
            points_possible: 10,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
          },
          {
            course_id: 1,
            canvas_id: 4,
            name: 'Lista Amanhã',
            due_at: '2026-11-27T18:00:00.000-03:00',
            points_possible: 5,
            submission_types: ['online_upload'],
            workflow_state: 'unsubmitted',
          },
        ],
        pucDeliverables: [{ course_id: 1, assignment_id: 3, status: 'entrega_gerada' }],
      })
    );

    assert.equal(sections.focoDoDia.length, 3);
    assert.match(sections.focoDoDia[0].titulo, /Trabalho Hoje Alto Peso|Lista Atrasada/);
    assert.ok(sections.focoDoDia.some((f) => f.titulo.includes('Lista Atrasada')));
    assert.ok(sections.focoDoDia.some((f) => f.titulo.includes('Trabalho Hoje Alto Peso')));
    assert.ok(sections.focoDoDia.some((f) => f.titulo.includes('Trabalho Pronto')));

    // Foco do dia aparece logo após o cabeçalho
    const speech = renderDeterministicSpeech(sections);
    const headerIdx = speech.indexOf('Quinta, 26 de novembro');
    const focusIdx = speech.indexOf('Foco do dia:');
    assert.ok(headerIdx >= 0 && focusIdx > headerIdx);
  });

  it('keeps working when a source fails and adds a discrete failure note', async () => {
    const { deps } = createMemoryDeps({
      sources: {
        fetchCalendar: async () => {
          throw new Error('google_not_connected');
        },
      },
      aiCaller: async () => {
        throw new Error('no_ai_providers_configured');
      },
    });

    const result = await generateOrGetBriefing(
      { now: new Date('2026-11-26T10:30:00.000Z') },
      deps
    );

    assert.ok(result.failedSources.includes('calendar'));
    assert.match(result.speech, /Calendário indisponível agora/);
    assert.ok(result.sections.clima !== null);
    assert.ok(result.sections.puc !== null);
  });

  it('falls back to deterministic text with AI-unavailable notice when AI fails or times out', async () => {
    const { deps } = createMemoryDeps({
      aiTimeoutMs: 50,
      aiCaller: async () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                provider: 'Groq',
                model: 'fast',
                raw: { speech: 'tarde demais', full: 'tarde demais' },
              }),
            300
          );
        }),
    });

    const result = await generateOrGetBriefing(
      { now: new Date('2026-11-26T10:30:00.000Z') },
      deps
    );

    assert.equal(result.aiUsed, false);
    assert.equal(result.aiFallbackReason, 'ai_timeout');
    assert.match(result.speech, /nenhuma IA estava disponível/i);
    assert.match(result.full, /nenhuma IA estava disponível/i);
  });

  it('validates text against markdown, emojis, and word limit', async () => {
    assert.equal(validateBriefingText('Bom dia. Hoje tem aula às 19h.', 120).ok, true);
    assert.equal(validateBriefingText('**Bom dia!** Hoje tem aula.', 120).ok, false);
    assert.equal(validateBriefingText('Bom dia ☀️ hoje tem aula.', 120).ok, false);
    assert.equal(validateBriefingText('palavra '.repeat(130), 125).ok, false);

    // Se a IA devolver texto estourando o limite de palavras, cai no fallback determinístico
    const { sections } = buildBriefingSections(baseInput());
    const aiRes = await redactBriefingWithAI(sections, {
      caller: async () => ({
        provider: 'Gemini',
        model: 'gemini-flash',
        raw: {
          speech: 'palavra '.repeat(160),
          full: 'Texto completo válido.',
        },
      }),
    });
    assert.equal(aiRes.usedAi, false);
    assert.match(String(aiRes.fallbackReason), /word_limit_exceeded/);
  });

  it('caches daily briefing and regenerates when refresh=true', async () => {
    const { deps, getCalendarCalls } = createMemoryDeps({
      aiCaller: async () => ({
        provider: 'Groq',
        model: 'llama-3.3',
        raw: {
          speech: 'Bom dia. Quinta, 26 de novembro. Reunião às 14h.',
          full: 'Bom dia. Quinta, 26 de novembro. Agenda: Reunião de alinhamento às 14h.',
        },
      }),
    });

    const now = new Date('2026-11-26T10:30:00.000Z');
    const first = await generateOrGetBriefing({ now }, deps);
    const second = await generateOrGetBriefing({ now }, deps);
    const refreshed = await generateOrGetBriefing({ now, refresh: true }, deps);

    assert.equal(first.cached, false);
    assert.equal(first.aiUsed, true);
    assert.equal(second.cached, true);
    assert.equal(refreshed.cached, false);
    assert.equal(getCalendarCalls(), 2); // 1ª chamada + refresh; 2ª veio do cache
  });

  it('sends at most one Web Push per day even across multiple calls and refresh=1', async () => {
    const { deps, sentPushes } = createMemoryDeps({
      config: { pushEnabled: true, pushScheduleTime: '' },
      aiCaller: async () => ({
        provider: 'Groq',
        model: 'llama-3.3',
        raw: {
          speech: 'Bom dia. Quinta, 26 de novembro.',
          full: 'Bom dia. Quinta, 26 de novembro.',
        },
      }),
    });

    const now = new Date('2026-11-26T10:30:00.000Z');
    const r1 = await generateOrGetBriefing({ now }, deps);
    const r2 = await generateOrGetBriefing({ now }, deps);
    const r3 = await generateOrGetBriefing({ now, refresh: true }, deps);

    assert.equal(r1.pushSent, true);
    assert.equal(r2.pushSent, false);
    assert.equal(r3.pushSent, false);
    assert.equal(sentPushes.length, 1);
    assert.equal(sentPushes[0].title, 'Bom dia');
    assert.equal(sentPushes[0].url, '/?page=puc');
    assert.ok(sentPushes[0].body.length <= 180);

    const payloadCheck = buildBriefingPushPayload(r1.sections);
    assert.ok(payloadCheck.body.length <= 180);
  });

  it('handles America/Sao_Paulo midnight boundary accurately for today/tomorrow classification', () => {
    // 2026-11-26T02:30:00Z = 25/11/2026 23:30 em São Paulo (ainda dia 25!)
    const lateNightBr = new Date('2026-11-26T02:30:00.000Z');
    // 2026-11-26T03:30:00Z = 26/11/2026 00:30 em São Paulo (já virou dia 26!)
    const earlyMorningBr = new Date('2026-11-26T03:30:00.000Z');

    assert.equal(getSaoPauloDateKey(lateNightBr), '2026-11-25');
    assert.equal(getSaoPauloDateKey(earlyMorningBr), '2026-11-26');

    const assignmentDue26 = {
      course_id: 1,
      canvas_id: 55,
      name: 'Entrega da Virada',
      due_at: '2026-11-26T22:00:00.000-03:00',
      submission_types: ['online_upload'],
      workflow_state: 'unsubmitted',
    };

    const beforeMidnight = buildBriefingSections(
      baseInput({
        now: lateNightBr,
        pucCourses: [{ canvas_id: 1, name: 'Cálculo - PUC', aliases: ['CALC'] }],
        pucAssignments: [assignmentDue26],
      })
    );
    assert.equal(beforeMidnight.sections.puc?.venceHoje.length, 0);
    assert.equal(beforeMidnight.sections.puc?.venceAmanha.length, 1);

    const afterMidnight = buildBriefingSections(
      baseInput({
        now: earlyMorningBr,
        pucCourses: [{ canvas_id: 1, name: 'Cálculo - PUC', aliases: ['CALC'] }],
        pucAssignments: [assignmentDue26],
      })
    );
    assert.equal(afterMidnight.sections.puc?.venceHoje.length, 1);
    assert.equal(afterMidnight.sections.puc?.venceAmanha.length, 0);
  });
});
