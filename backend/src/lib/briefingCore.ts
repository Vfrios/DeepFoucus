import { classifyDeliveryStatus, generateAutoAliases, normalizeText } from './canvasUtils';
import { CalEvent } from './google';
import { isReadyToSubmitInCanvas, normalizeDeliverableStatus, sanitizeHtmlToText } from './pucAssistantCore';
import { DetailedWeather } from './weather';

export const BRIEFING_TIME_ZONE = 'America/Sao_Paulo';

export interface BriefingSectionsToggle {
  weather: boolean;
  calendar: boolean;
  pucDeliveries: boolean;
  pucNews: boolean;
  systemAlerts: boolean;
  tasks: boolean;
}

export interface BriefingConfig {
  sections: BriefingSectionsToggle;
  includedCalendarIds: string[]; // vazio = todos exceto ignoredCalendarIds
  ignoredCalendarIds: string[];
  maxItemsPerSection: number;
  minFreeWindowMinutes: number;
  pushEnabled: boolean;
  pushScheduleTime: string; // "" = na primeira chamada do dia; "HH:MM" = agendado
}

export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = {
  sections: {
    weather: true,
    calendar: true,
    pucDeliveries: true,
    pucNews: true,
    systemAlerts: true,
    tasks: true,
  },
  includedCalendarIds: [],
  ignoredCalendarIds: [],
  maxItemsPerSection: 5,
  minFreeWindowMinutes: 90,
  pushEnabled: false,
  pushScheduleTime: '',
};

export function getDefaultBriefingConfig(): BriefingConfig {
  const envPush = String(process.env.PUC_BRIEFING_PUSH || '').trim().toLowerCase();
  const envTime = String(process.env.PUC_BRIEFING_PUSH_TIME || '').trim();
  return {
    ...DEFAULT_BRIEFING_CONFIG,
    sections: { ...DEFAULT_BRIEFING_CONFIG.sections },
    includedCalendarIds: [],
    ignoredCalendarIds: [],
    pushEnabled: envPush === 'true' || envPush === '1',
    pushScheduleTime: isValidClock(envTime) ? envTime : '',
  };
}

export function isValidClock(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export function sanitizeBriefingConfig(raw: unknown, base: BriefingConfig = getDefaultBriefingConfig()): BriefingConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  const sec = obj.sections && typeof obj.sections === 'object' && !Array.isArray(obj.sections)
    ? (obj.sections as Record<string, unknown>)
    : {};

  const strArray = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v)
      ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, 100)))
      : fallback;

  const maxItems = typeof obj.maxItemsPerSection === 'number' && Number.isFinite(obj.maxItemsPerSection)
    ? Math.max(1, Math.min(10, Math.round(obj.maxItemsPerSection)))
    : base.maxItemsPerSection;

  const minWindow = typeof obj.minFreeWindowMinutes === 'number' && Number.isFinite(obj.minFreeWindowMinutes)
    ? Math.max(30, Math.min(360, Math.round(obj.minFreeWindowMinutes)))
    : base.minFreeWindowMinutes;

  const pushScheduleTime = typeof obj.pushScheduleTime === 'string'
    ? (obj.pushScheduleTime.trim() === '' ? '' : isValidClock(obj.pushScheduleTime.trim()) ? obj.pushScheduleTime.trim() : base.pushScheduleTime)
    : base.pushScheduleTime;

  return {
    sections: {
      weather: typeof sec.weather === 'boolean' ? sec.weather : base.sections.weather,
      calendar: typeof sec.calendar === 'boolean' ? sec.calendar : base.sections.calendar,
      pucDeliveries: typeof sec.pucDeliveries === 'boolean' ? sec.pucDeliveries : base.sections.pucDeliveries,
      pucNews: typeof sec.pucNews === 'boolean' ? sec.pucNews : base.sections.pucNews,
      systemAlerts: typeof sec.systemAlerts === 'boolean' ? sec.systemAlerts : base.sections.systemAlerts,
      tasks: typeof sec.tasks === 'boolean' ? sec.tasks : base.sections.tasks,
    },
    includedCalendarIds: strArray(obj.includedCalendarIds, base.includedCalendarIds),
    ignoredCalendarIds: strArray(obj.ignoredCalendarIds, base.ignoredCalendarIds),
    maxItemsPerSection: maxItems,
    minFreeWindowMinutes: minWindow,
    pushEnabled: typeof obj.pushEnabled === 'boolean' ? obj.pushEnabled : base.pushEnabled,
    pushScheduleTime,
  };
}

// ---------- Timezone Helpers (America/Sao_Paulo) ----------

export function getSaoPauloDateKey(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: BRIEFING_TIME_ZONE }).format(date);
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const anchor = new Date(`${dateKey}T12:00:00.000-03:00`);
  anchor.setTime(anchor.getTime() + deltaDays * 86_400_000);
  return getSaoPauloDateKey(anchor);
}

export function getSaoPauloMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BRIEFING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

export function formatSpokenTime(dateOrIso: Date | string): string {
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = getSaoPauloMinutesOfDay(d);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function formatMinutesAsClock(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function formatDurationShort(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

const WEEKDAYS_SHORT_PT: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
};

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function formatHeaderDate(now: Date): string {
  const key = getSaoPauloDateKey(now);
  const [y, m, d] = key.split('-').map(Number);
  const anchor = new Date(`${key}T12:00:00.000-03:00`);
  const weekday = WEEKDAYS_SHORT_PT[anchor.getUTCDay()] || 'Hoje';
  const month = MONTHS_PT[(m || 1) - 1] || '';
  return `${weekday}, ${d} de ${month}`;
}

export function getGreeting(now: Date): string {
  const mins = getSaoPauloMinutesOfDay(now);
  if (mins < 12 * 60) return 'Bom dia';
  if (mins < 18 * 60) return 'Boa tarde';
  return 'Boa noite';
}

export function formatRelativeDay(targetDate: Date, now: Date): string {
  const todayKey = getSaoPauloDateKey(now);
  const targetKey = getSaoPauloDateKey(targetDate);
  if (targetKey === todayKey) return 'hoje';
  if (targetKey === shiftDateKey(todayKey, 1)) return 'amanhã';
  if (targetKey === shiftDateKey(todayKey, -1)) return 'ontem';
  const anchor = new Date(`${targetKey}T12:00:00.000-03:00`);
  return (WEEKDAYS_SHORT_PT[anchor.getUTCDay()] || targetKey).toLowerCase();
}

// ---------- Input Data Shapes ----------

export interface RawPucCourse {
  canvas_id: number;
  name: string;
  course_code?: string;
  aliases?: string[];
  auto_aliases?: string[];
  hidden?: boolean;
  active?: boolean;
}

export interface RawPucAssignment {
  course_id: number;
  canvas_id: number;
  course_name?: string;
  name: string;
  due_at?: Date | string | null;
  lock_at?: Date | string | null;
  locked_for_user?: boolean;
  points_possible?: number | null;
  submission_types?: string[];
  workflow_state?: string | null;
  submitted_at?: Date | string | null;
  score?: number | null;
  grade?: string | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean;
  statement_hash?: string | null;
  first_seen_at?: Date | string | null;
  updated_at?: Date | string | null;
}

export interface RawPucDeliverable {
  course_id: number;
  assignment_id: number;
  status?: string | null;
  statement_changed?: boolean;
  updated_at?: Date | string | null;
}

export interface RawPucAgentRecord {
  course_id: number;
  assignment_id: number;
  status?: string | null;
  reason?: string | null;
  error?: string | null;
  updated_at?: Date | string | null;
}

export interface RawPucAnnouncement {
  course_id: number;
  canvas_id: number;
  course_name?: string;
  title: string;
  message?: string | null;
  posted_at?: Date | string | null;
  read?: boolean;
}

export interface RawTaskItem {
  _id: string;
  titulo?: string;
  texto?: string;
  inicio?: string | Date | null;
  data?: string | Date | null;
  feito?: boolean;
  googleEventId?: string | null;
}

export interface RawSystemAlertInputs {
  canvasToken?: {
    configured: boolean;
    decryptError?: boolean;
    expired: boolean;
    expired401?: boolean;
    expiringSoon: boolean;
    daysRemaining: number | null;
  } | null;
  githubToken?: {
    configured: boolean;
    decryptError?: boolean;
    expired: boolean;
    expiringSoon: boolean;
    daysRemaining: number | null;
    authError: 401 | 403 | null;
  } | null;
  lastCanvasSync?: {
    status?: string | null;
    error?: string | null;
    finished_at?: Date | string | null;
    started_at?: Date | string | null;
  } | null;
  pucAgent?: {
    enabled: boolean;
    paused: boolean;
    quotaPausedReason?: string | null;
  } | null;
}

export interface AssignmentSnapshotEntry {
  dueAt: string | null;
  score: number | null;
  grade: string | null;
  deliveryStatus: string;
  deliverableStatus: string | null;
  statementHash: string | null;
}

export interface BriefingSnapshot {
  dateKey: string;
  generatedAt: string;
  reportedNewsIds: string[];
  assignmentSnapshots: Record<string, AssignmentSnapshotEntry>;
}

export interface BriefingRawInput {
  now: Date;
  config: BriefingConfig;
  previousSnapshot: BriefingSnapshot | null;
  weather: DetailedWeather | null;
  calendarEvents: CalEvent[];
  pucCourses: RawPucCourse[];
  pucAssignments: RawPucAssignment[];
  pucDeliverables: RawPucDeliverable[];
  pucAgentRecords: RawPucAgentRecord[];
  pucAnnouncements: RawPucAnnouncement[];
  tasks: RawTaskItem[];
  systemAlerts: RawSystemAlertInputs | null;
  failedSources: string[];
}

// ---------- Structured Output Shapes ----------

export interface BriefingFocusItem {
  id: string;
  titulo: string;
  motivo: string;
  prioridade: number;
}

export interface BriefingCalendarEventItem {
  id: string;
  titulo: string;
  horario: string;
  duracao: string;
  local: string | null;
  allDay: boolean;
  startMs: number;
  endMs: number;
  mergedPucAcronym?: string;
}

export interface BriefingFreeWindow {
  inicio: string;
  fim: string;
  duracaoMin: number;
  duracaoTexto: string;
}

export interface BriefingCalendarSection {
  eventos: BriefingCalendarEventItem[];
  overflowEventos: number;
  diaInteiro: string[];
  proximoEvento: {
    titulo: string;
    horario: string;
    emTexto: string;
  } | null;
  conflitos: Array<{ a: string; b: string; horario: string }>;
  janelasLivres: BriefingFreeWindow[];
}

export interface BriefingPucItem {
  id: string;
  sigla: string;
  nome: string;
  prazo: string | null;
  diaRelativo: string | null;
  pontos: number | null;
  categoria: 'atrasado' | 'vence_hoje' | 'vence_amanha' | 'a_verificar' | 'pronto_para_enviar' | 'precisa_de_voce';
  detalhe?: string;
  dueMs: number | null;
}

export interface BriefingPucNewsItem {
  id: string;
  tipo: 'trabalho_novo' | 'nota_nova' | 'aviso_novo' | 'prazo_alterado' | 'enunciado_alterado';
  sigla: string;
  texto: string;
}

export interface BriefingPucSection {
  atrasadas: BriefingPucItem[];
  overflowAtrasadas: number;
  venceHoje: BriefingPucItem[];
  overflowVenceHoje: number;
  venceAmanha: BriefingPucItem[];
  overflowVenceAmanha: number;
  aVerificar: BriefingPucItem[];
  totalAVerificar: number;
  prontasParaEnviar: BriefingPucItem[];
  totalProntasParaEnviar: number;
  precisaDeVoce: BriefingPucItem[];
  overflowPrecisaDeVoce: number;
  novidades: BriefingPucNewsItem[];
  overflowNovidades: number;
}

export interface BriefingTaskItem {
  id: string;
  titulo: string;
  atrasada: boolean;
  horario: string | null;
}

export interface BriefingSections {
  dateKey: string;
  cabecalho: {
    saudacao: string;
    dataTexto: string;
  };
  focoDoDia: BriefingFocusItem[];
  clima: DetailedWeather | null;
  agenda: BriefingCalendarSection | null;
  puc: BriefingPucSection | null;
  alertasSistema: string[];
  tarefas: {
    itens: BriefingTaskItem[];
    overflow: number;
  } | null;
  notasFalha: string[];
}

export interface BuildBriefingSectionsResult {
  sections: BriefingSections;
  snapshot: BriefingSnapshot;
}

// ---------- Helpers ----------

function shortenTitle(raw: string, maxLen = 48): string {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Atividades institucionais que não são entregas reais e nunca devem entrar no briefing
 * (ex.: ADA - Avaliação Diagnóstica de Aprendizagem).
 */
const IGNORED_ASSIGNMENT_PATTERNS: RegExp[] = [
  /\bada\b/i,
  /avalia[cç][aã]o\s+diagn[oó]stica/i,
];

export function isIgnoredPucAssignment(name: string): boolean {
  const clean = String(name || '').trim();
  if (!clean) return false;
  return IGNORED_ASSIGNMENT_PATTERNS.some((re) => re.test(clean));
}

const FRIENDLY_COURSE_RULES: Array<{ match: RegExp; label: string }> = [
  { match: /introducao\s+a\s+pesquisa\s+em\s+informatica|pesquisa\s+em\s+informatica|\bipi\b/i, label: 'Pesquisa' },
  { match: /\bmetodologia\b/i, label: 'Metodologia' },
  { match: /trabalho\s+interdisciplinar/i, label: 'TI' },
  { match: /interacao\s+humano[\s-]+computador|\bihc\b/i, label: 'IHC' },
  { match: /programacao\s+modular|\bpm\b/i, label: 'PM' },
  { match: /desenvolvimento\s+e\s+integracao\s+de\s+aplicacoes\s+web|\bdiaw\b/i, label: 'DIAW' },
];

export function resolveCourseSigla(course: RawPucCourse | undefined, fallbackCourseName?: string): string {
  // 1. Apelido manual configurado pelo usuário sempre tem prioridade
  if (course?.aliases && course.aliases.length > 0 && course.aliases[0]?.trim()) {
    return course.aliases[0].trim();
  }

  // 2. Nomes curtos/siglas naturais faláveis (IHC, PM, Metodologia, DIAW, Pesquisa, TI)
  const rawName = course?.name || fallbackCourseName || '';
  const mainTitle = rawName.split(/\s+-\s+/)[0] || rawName;
  const normTitle = normalizeText(mainTitle);
  const autoAliases = Array.isArray(course?.auto_aliases) ? course!.auto_aliases! : [];
  const matchHaystack = `${normTitle} ${normalizeText(autoAliases.join(' '))}`;

  for (const rule of FRIENDLY_COURSE_RULES) {
    if (rule.match.test(matchHaystack)) {
      return rule.label;
    }
  }

  // 3. Sigla automática ou título principal curto
  if (autoAliases.length > 0 && autoAliases[0]?.trim()) {
    return autoAliases[0].trim().toUpperCase();
  }
  const generated = generateAutoAliases(rawName || 'PUC', course?.course_code || '');
  if (generated.length > 0) return generated[0];
  return (mainTitle.trim() || 'PUC').slice(0, 18);
}

function summarizeAnnouncement(title: string, message: string | null | undefined): string {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const bodyText = sanitizeHtmlToText(message, 400).replace(/\s+/g, ' ').trim();
  if (!bodyText) return shortenTitle(cleanTitle, 90);
  const firstSentence = bodyText.split(/(?<=[.!?])\s+/)[0] || bodyText;
  const combined = normalizeText(firstSentence).includes(normalizeText(cleanTitle).slice(0, 15))
    ? firstSentence
    : `${cleanTitle}: ${firstSentence}`;
  return shortenTitle(combined, 110);
}

function tokenizeForMatch(text: string): Set<string> {
  const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'para', 'com', 'entrega', 'trabalho', 'atividade', 'puc', 'canvas']);
  const tokens = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
  return new Set(tokens);
}

export function isSameCalendarAndPucItem(
  eventTitle: string,
  eventStartIso: string,
  pucName: string,
  pucSigla: string,
  pucDueIso: string | null
): boolean {
  const evNorm = normalizeText(eventTitle);
  const pucNorm = normalizeText(pucName);
  if (!evNorm || !pucNorm) return false;

  // Verifica proximidade temporal quando ambos têm data válida
  if (pucDueIso && eventStartIso) {
    const evDate = new Date(eventStartIso);
    const pucDate = new Date(pucDueIso);
    if (!Number.isNaN(evDate.getTime()) && !Number.isNaN(pucDate.getTime())) {
      const sameDay = getSaoPauloDateKey(evDate) === getSaoPauloDateKey(pucDate);
      const diffHours = Math.abs(evDate.getTime() - pucDate.getTime()) / 3_600_000;
      if (!sameDay && diffHours > 18) return false;
    }
  }

  if (evNorm === pucNorm || evNorm.includes(pucNorm) || pucNorm.includes(evNorm)) {
    return true;
  }

  const evTokens = tokenizeForMatch(eventTitle);
  const pucTokens = tokenizeForMatch(pucName);
  if (evTokens.size === 0 || pucTokens.size === 0) return false;

  let overlap = 0;
  for (const t of pucTokens) {
    if (evTokens.has(t)) overlap += 1;
  }
  const siglaNorm = normalizeText(pucSigla);
  const mentionsSigla = siglaNorm.length >= 2 && evNorm.includes(siglaNorm);
  const minSize = Math.min(evTokens.size, pucTokens.size);
  if (overlap >= 2 && overlap / minSize >= 0.5) return true;
  if (mentionsSigla && overlap >= 1) return true;

  return false;
}

function capList<T>(items: T[], limit: number): { kept: T[]; overflow: number } {
  if (items.length <= limit) return { kept: items, overflow: 0 };
  return { kept: items.slice(0, limit), overflow: items.length - limit };
}

// ---------- Core Deterministic Pipeline ----------

export function buildBriefingSections(input: BriefingRawInput): BuildBriefingSectionsResult {
  const { now, config, previousSnapshot } = input;
  const todayKey = getSaoPauloDateKey(now);
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const limit = config.maxItemsPerSection;

  const prevNewsIds = new Set(previousSnapshot?.reportedNewsIds ?? []);
  const prevAssignments = previousSnapshot?.assignmentSnapshots ?? {};
  const nextReportedNewsIds = new Set<string>(prevNewsIds);
  const nextAssignmentSnapshots: Record<string, AssignmentSnapshotEntry> = {};

  const courseMap = new Map<number, RawPucCourse>();
  for (const c of input.pucCourses) {
    courseMap.set(Number(c.canvas_id), c);
  }

  const deliverableMap = new Map<string, RawPucDeliverable>();
  for (const d of input.pucDeliverables) {
    deliverableMap.set(`${d.course_id}:${d.assignment_id}`, d);
  }

  const agentRecordMap = new Map<string, RawPucAgentRecord>();
  for (const r of input.pucAgentRecords) {
    agentRecordMap.set(`${r.course_id}:${r.assignment_id}`, r);
  }

  // ---- 1. PUC Processing (with strict single-appearance priority) ----
  const atrasadasAll: BriefingPucItem[] = [];
  const venceHojeAll: BriefingPucItem[] = [];
  const venceAmanhaAll: BriefingPucItem[] = [];
  const aVerificarAll: BriefingPucItem[] = [];
  const prontasAll: BriefingPucItem[] = [];
  const precisaDeVoceAll: BriefingPucItem[] = [];
  const novidadesAll: BriefingPucNewsItem[] = [];

  // Guardará todos os itens PUC ativos para deduplicação com o Google Calendar
  const activePucForCalendarMatch: Array<{
    name: string;
    sigla: string;
    dueIso: string | null;
    item: BriefingPucItem;
  }> = [];

  // Set de IDs já alocados em seções de maior prioridade (cada item aparece UMA vez)
  const claimedAssignmentKeys = new Set<string>();

  if (config.sections.pucDeliveries || config.sections.pucNews) {
    for (const a of input.pucAssignments) {
      if (isIgnoredPucAssignment(a.name)) continue;
      const key = `${a.course_id}:${a.canvas_id}`;
      const stableId = `puc:assignment:${key}`;
      const course = courseMap.get(Number(a.course_id));
      const sigla = resolveCourseSigla(course, a.course_name);
      const shortName = shortenTitle(a.name, 45);
      const deliveryStatus = classifyDeliveryStatus(a as any, now);
      const deliverable = deliverableMap.get(key);
      const deliverableStatus = deliverable?.status ? normalizeDeliverableStatus(deliverable.status) : null;
      const agentRec = agentRecordMap.get(key);
      const dueDate = a.due_at ? new Date(a.due_at) : null;
      const validDue = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;
      const dueIso = validDue ? validDue.toISOString() : null;
      const dueKey = validDue ? getSaoPauloDateKey(validDue) : null;
      const dueMs = validDue ? validDue.getTime() : null;
      const prazo = validDue ? formatSpokenTime(validDue) : null;
      const pontos = typeof a.points_possible === 'number' && a.points_possible > 0 ? a.points_possible : null;

      // Salva snapshot para comparação amanhã
      nextAssignmentSnapshots[key] = {
        dueAt: dueIso,
        score: typeof a.score === 'number' ? a.score : null,
        grade: a.grade ?? null,
        deliveryStatus,
        deliverableStatus,
        statementHash: a.statement_hash ?? null,
      };

      const prevSnap = prevAssignments[key];
      const isPendingOrOverdue = deliveryStatus === 'pendente' || deliveryStatus === 'atrasado';
      const isReadyToSubmit = isReadyToSubmitInCanvas(deliverableStatus, deliveryStatus);
      const isAwaitingReview =
        isPendingOrOverdue &&
        (deliverableStatus === 'enviado_a_verificar' ||
          deliverableStatus === 'rascunho' ||
          deliverableStatus === 'revisada_por_mim' ||
          agentRec?.status === 'enviado_a_verificar');
      const isNeedsUser =
        isPendingOrOverdue &&
        (agentRec?.status === 'precisa_de_voce' || agentRec?.status === 'erro');

      if (config.sections.pucDeliveries) {
        // Ordem de prioridade estrita:
        // atrasado > vence hoje > vence amanhã > precisa de você > a verificar > pronto para enviar > novidade
        let placedItem: BriefingPucItem | null = null;

        if (deliveryStatus === 'atrasado') {
          placedItem = {
            id: stableId,
            sigla,
            nome: shortName,
            prazo,
            diaRelativo: validDue ? formatRelativeDay(validDue, now) : null,
            pontos,
            categoria: 'atrasado',
            dueMs,
          };
          atrasadasAll.push(placedItem);
        } else if (isPendingOrOverdue && dueKey === todayKey) {
          placedItem = {
            id: stableId,
            sigla,
            nome: shortName,
            prazo,
            diaRelativo: 'hoje',
            pontos,
            categoria: 'vence_hoje',
            detalhe: isReadyToSubmit ? 'pronta para enviar' : isAwaitingReview ? 'a verificar' : undefined,
            dueMs,
          };
          venceHojeAll.push(placedItem);
        } else if (isPendingOrOverdue && dueKey === tomorrowKey) {
          placedItem = {
            id: stableId,
            sigla,
            nome: shortName,
            prazo,
            diaRelativo: 'amanhã',
            pontos,
            categoria: 'vence_amanha',
            detalhe: isReadyToSubmit ? 'pronta para enviar' : isAwaitingReview ? 'a verificar' : undefined,
            dueMs,
          };
          venceAmanhaAll.push(placedItem);
        } else if (isNeedsUser) {
          placedItem = {
            id: stableId,
            sigla,
            nome: shortName,
            prazo,
            diaRelativo: validDue ? formatRelativeDay(validDue, now) : null,
            pontos,
            categoria: 'precisa_de_voce',
            detalhe: agentRec?.reason || agentRec?.error || 'aguarda decisão',
            dueMs,
          };
          precisaDeVoceAll.push(placedItem);
        } else if (isAwaitingReview) {
          placedItem = {
            id: stableId,
            sigla,
            nome: shortName,
            prazo,
            diaRelativo: validDue ? formatRelativeDay(validDue, now) : null,
            pontos,
            categoria: 'a_verificar',
            dueMs,
          };
          aVerificarAll.push(placedItem);
        } else if (isReadyToSubmit) {
          placedItem = {
            id: stableId,
            sigla,
            nome: shortName,
            prazo,
            diaRelativo: validDue ? formatRelativeDay(validDue, now) : null,
            pontos,
            categoria: 'pronto_para_enviar',
            dueMs,
          };
          prontasAll.push(placedItem);
        }

        if (placedItem) {
          claimedAssignmentKeys.add(key);
          activePucForCalendarMatch.push({
            name: a.name,
            sigla,
            dueIso,
            item: placedItem,
          });
        }
      }

      // Novidades desde o último briefing (somente se ainda não foi dita ontem e não duplicar entrega já citada)
      if (config.sections.pucNews) {
        // 1. Nota nova (sempre relevante mesmo se entregue)
        const hasGradeNow = typeof a.score === 'number' || (typeof a.grade === 'string' && a.grade.trim().length > 0);
        const gradeVal =
          typeof a.score === 'number' && typeof a.points_possible === 'number'
            ? `${a.score} de ${a.points_possible}`
            : a.grade || (typeof a.score === 'number' ? String(a.score) : '');
        const gradeNewsId = `puc:grade:${key}:${gradeVal}`;
        const gradeChanged = prevSnap
          ? (typeof a.score === 'number' && a.score !== prevSnap.score) ||
            (Boolean(a.grade) && a.grade !== prevSnap.grade)
          : false;

        if (hasGradeNow && gradeChanged && !prevNewsIds.has(gradeNewsId)) {
          novidadesAll.push({
            id: gradeNewsId,
            tipo: 'nota_nova',
            sigla,
            texto: `nota em ${sigla}, ${shortName}: ${gradeVal}`,
          });
          nextReportedNewsIds.add(gradeNewsId);
        }

        // 2. Mudança de prazo
        if (prevSnap && dueIso && prevSnap.dueAt !== dueIso) {
          const dueChangeId = `puc:due_changed:${key}:${dueIso}`;
          if (!prevNewsIds.has(dueChangeId) && !claimedAssignmentKeys.has(key)) {
            novidadesAll.push({
              id: dueChangeId,
              tipo: 'prazo_alterado',
              sigla,
              texto: `prazo alterado em ${sigla}, ${shortName}, para ${formatRelativeDay(validDue!, now)} às ${prazo}`,
            });
            nextReportedNewsIds.add(dueChangeId);
          }
        }

        // 3. Mudança de enunciado
        const statementChanged =
          Boolean(deliverable?.statement_changed) ||
          Boolean(prevSnap && prevSnap.statementHash && a.statement_hash && prevSnap.statementHash !== a.statement_hash);
        if (statementChanged) {
          const stmtId = `puc:stmt_changed:${key}:${a.statement_hash || 'flag'}`;
          if (!prevNewsIds.has(stmtId)) {
            novidadesAll.push({
              id: stmtId,
              tipo: 'enunciado_alterado',
              sigla,
              texto: `enunciado alterado em ${sigla}, ${shortName}`,
            });
            nextReportedNewsIds.add(stmtId);
          }
        }

        // 4. Trabalho novo (não existia no snapshot anterior e não já listado em entregas urgentes)
        const newWorkId = `puc:new:${key}`;
        const isTrulyNew = previousSnapshot
          ? !prevSnap && isPendingOrOverdue
          : Boolean(
              isPendingOrOverdue &&
                a.first_seen_at &&
                now.getTime() - new Date(a.first_seen_at).getTime() <= 24 * 3_600_000
            );
        if (isTrulyNew && !prevNewsIds.has(newWorkId) && !claimedAssignmentKeys.has(key)) {
          novidadesAll.push({
            id: newWorkId,
            tipo: 'trabalho_novo',
            sigla,
            texto: `novo trabalho em ${sigla}: ${shortName}${validDue ? `, para ${formatRelativeDay(validDue, now)}` : ''}`,
          });
          nextReportedNewsIds.add(newWorkId);
        }
      }
    }

    // 5. Avisos novos não lidos (máximo 3, 1 frase por aviso, sem repetir avisos de ontem)
    if (config.sections.pucNews) {
      const unreadAnnouncements = input.pucAnnouncements
        .filter((ann) => ann.read !== true)
        .sort((a, b) => {
          const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
          const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
          return tb - ta;
        });

      let addedAnnouncements = 0;
      for (const ann of unreadAnnouncements) {
        if (addedAnnouncements >= 3) break;
        const annId = `puc:announcement:${ann.course_id}:${ann.canvas_id}`;
        if (prevNewsIds.has(annId)) continue;
        const course = courseMap.get(Number(ann.course_id));
        const sigla = resolveCourseSigla(course, ann.course_name);
        novidadesAll.push({
          id: annId,
          tipo: 'aviso_novo',
          sigla,
          texto: `aviso de ${sigla}: ${summarizeAnnouncement(ann.title, ann.message)}`,
        });
        nextReportedNewsIds.add(annId);
        addedAnnouncements += 1;
      }
    }
  }

  // Ordenar entregas PUC por prazo mais próximo
  const byDueAsc = (a: BriefingPucItem, b: BriefingPucItem) =>
    (a.dueMs ?? Number.MAX_SAFE_INTEGER) - (b.dueMs ?? Number.MAX_SAFE_INTEGER);
  atrasadasAll.sort(byDueAsc);
  venceHojeAll.sort(byDueAsc);
  venceAmanhaAll.sort(byDueAsc);
  aVerificarAll.sort(byDueAsc);
  prontasAll.sort(byDueAsc);
  precisaDeVoceAll.sort(byDueAsc);

  // ---- 2. Google Calendar Processing (today, filtered, deduplicated vs PUC) ----
  let agendaSection: BriefingCalendarSection | null = null;
  const calendarEventGoogleIds = new Set<string>();
  const calendarEventTitlesNorm = new Set<string>();

  if (config.sections.calendar && !input.failedSources.includes('calendar')) {
    const includeSet = config.includedCalendarIds.length > 0 ? new Set(config.includedCalendarIds) : null;
    const ignoreSet = new Set(config.ignoredCalendarIds);

    const todayEvents = input.calendarEvents.filter((ev) => {
      if (includeSet && !includeSet.has(ev.calendarId)) return false;
      if (ignoreSet.has(ev.calendarId)) return false;
      if (!ev.start) return false;
      if (ev.allDay) {
        const startDay = ev.start.slice(0, 10);
        const endDay = ev.end ? ev.end.slice(0, 10) : startDay;
        return startDay <= todayKey && (endDay > todayKey || startDay === todayKey);
      }
      const d = new Date(ev.start);
      if (Number.isNaN(d.getTime())) return false;
      return getSaoPauloDateKey(d) === todayKey;
    });

    const timedEvents: BriefingCalendarEventItem[] = [];
    const allDayTitles: string[] = [];

    for (const ev of todayEvents) {
      const rawGoogleId = ev.id.includes(':') ? ev.id.split(':').slice(1).join(':') : ev.id;
      calendarEventGoogleIds.add(rawGoogleId);
      calendarEventTitlesNorm.add(normalizeText(ev.title));

      // Deduplicação Calendar <-> PUC: se for a mesma entrega da PUC, mescla em um único item (mantém na PUC)
      const matchedPuc = activePucForCalendarMatch.find((p) =>
        isSameCalendarAndPucItem(ev.title, ev.start, p.name, p.sigla, p.dueIso)
      );
      if (matchedPuc) {
        if (!matchedPuc.item.prazo && !ev.allDay) {
          matchedPuc.item.prazo = formatSpokenTime(ev.start);
        }
        continue;
      }

      if (ev.allDay) {
        const titleClean = shortenTitle(ev.title, 45);
        if (titleClean && !allDayTitles.includes(titleClean)) {
          allDayTitles.push(titleClean);
        }
        continue;
      }

      const start = new Date(ev.start);
      const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000);
      const startMs = start.getTime();
      const endMs = Number.isNaN(end.getTime()) || end.getTime() <= startMs
        ? startMs + 60 * 60 * 1000
        : end.getTime();
      const durMin = Math.max(5, Math.round((endMs - startMs) / 60_000));

      timedEvents.push({
        id: `cal:${ev.id}`,
        titulo: shortenTitle(ev.title, 48),
        horario: formatSpokenTime(start),
        duracao: formatDurationShort(durMin),
        local: ev.location ? shortenTitle(ev.location, 35) : null,
        allDay: false,
        startMs,
        endMs,
      });
    }

    timedEvents.sort((a, b) => a.startMs - b.startMs);

    // Conflitos de horário (eventos sobrepostos)
    const conflitos: Array<{ a: string; b: string; horario: string }> = [];
    for (let i = 0; i < timedEvents.length; i++) {
      for (let j = i + 1; j < timedEvents.length; j++) {
        if (timedEvents[j].startMs < timedEvents[i].endMs) {
          conflitos.push({
            a: timedEvents[i].titulo,
            b: timedEvents[j].titulo,
            horario: timedEvents[j].horario,
          });
        } else {
          break;
        }
      }
    }

    // Próximo evento futuro em relação a `now`
    const nextEv = timedEvents.find((e) => e.startMs > now.getTime()) || null;
    const proximoEvento = nextEv
      ? {
          titulo: nextEv.titulo,
          horario: nextEv.horario,
          emTexto: `em ${formatDurationShort((nextEv.startMs - now.getTime()) / 60_000)}`,
        }
      : null;

    // Janelas livres grandes (>= config.minFreeWindowMinutes) entre max(now, 08:00) e 22:00
    const dayStartMin = Math.max(8 * 60, getSaoPauloMinutesOfDay(now));
    const dayEndMin = 22 * 60;
    const janelasLivres: BriefingFreeWindow[] = [];

    if (dayStartMin + config.minFreeWindowMinutes <= dayEndMin) {
      const busy: Array<[number, number]> = timedEvents
        .map((e): [number, number] => [
          getSaoPauloMinutesOfDay(new Date(e.startMs)),
          Math.min(dayEndMin, getSaoPauloMinutesOfDay(new Date(e.endMs))),
        ])
        .filter(([s, e]) => e > dayStartMin && s < dayEndMin)
        .sort((a, b) => a[0] - b[0]);

      // Merge intervalos ocupados
      const mergedBusy: Array<[number, number]> = [];
      for (const [s, e] of busy) {
        const clampedS = Math.max(dayStartMin, s);
        const clampedE = Math.min(dayEndMin, e);
        if (mergedBusy.length === 0 || clampedS > mergedBusy[mergedBusy.length - 1][1]) {
          mergedBusy.push([clampedS, clampedE]);
        } else {
          mergedBusy[mergedBusy.length - 1][1] = Math.max(mergedBusy[mergedBusy.length - 1][1], clampedE);
        }
      }

      let cursor = dayStartMin;
      for (const [s, e] of mergedBusy) {
        if (s - cursor >= config.minFreeWindowMinutes) {
          janelasLivres.push({
            inicio: formatMinutesAsClock(cursor),
            fim: formatMinutesAsClock(s),
            duracaoMin: s - cursor,
            duracaoTexto: formatDurationShort(s - cursor),
          });
        }
        cursor = Math.max(cursor, e);
      }
      if (dayEndMin - cursor >= config.minFreeWindowMinutes) {
        janelasLivres.push({
          inicio: formatMinutesAsClock(cursor),
          fim: formatMinutesAsClock(dayEndMin),
          duracaoMin: dayEndMin - cursor,
          duracaoTexto: formatDurationShort(dayEndMin - cursor),
        });
      }
    }

    const cappedEvents = capList(timedEvents, limit);
    if (cappedEvents.kept.length > 0 || allDayTitles.length > 0) {
      agendaSection = {
        eventos: cappedEvents.kept,
        overflowEventos: cappedEvents.overflow,
        diaInteiro: allDayTitles.slice(0, limit),
        proximoEvento,
        conflitos: conflitos.slice(0, 3),
        janelasLivres: janelasLivres.slice(0, 3),
      };
    }
  }

  // ---- 3. Tasks (apenas vence hoje ou atrasada, sem duplicar com Calendar) ----
  let tarefasSection: { itens: BriefingTaskItem[]; overflow: number } | null = null;
  if (config.sections.tasks && !input.failedSources.includes('tasks')) {
    const dueTasks: BriefingTaskItem[] = [];
    for (const t of input.tasks) {
      if (t.feito) continue;
      const rawDate = t.inicio ?? t.data;
      if (!rawDate) continue;
      const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (Number.isNaN(d.getTime())) continue;
      const taskDay = getSaoPauloDateKey(d);
      if (taskDay > todayKey) continue; // apenas hoje ou atrasada

      const title = shortenTitle(t.titulo || t.texto || '', 48);
      if (!title) continue;
      if (t.googleEventId && calendarEventGoogleIds.has(t.googleEventId)) continue;
      if (calendarEventTitlesNorm.has(normalizeText(title))) continue;

      dueTasks.push({
        id: `task:${t._id}`,
        titulo: title,
        atrasada: taskDay < todayKey,
        horario: taskDay === todayKey ? formatSpokenTime(d) : null,
      });
    }
    dueTasks.sort((a, b) => Number(b.atrasada) - Number(a.atrasada));
    if (dueTasks.length > 0) {
      const capped = capList(dueTasks, limit);
      tarefasSection = { itens: capped.kept, overflow: capped.overflow };
    }
  }

  // ---- 4. System Alerts ----
  const alertasSistema: string[] = [];
  if (config.sections.systemAlerts && input.systemAlerts) {
    const sa = input.systemAlerts;
    // Canvas: único token com expiração — avisa apenas em 401 real ou a partir de 5 dias faltantes
    if (sa.canvasToken?.configured && !sa.canvasToken.decryptError) {
      if (sa.canvasToken.expired401) {
        alertasSistema.push('Token do Canvas expirou e precisa ser renovado na página PUC.');
      } else if (typeof sa.canvasToken.daysRemaining === 'number' && sa.canvasToken.daysRemaining <= 0) {
        alertasSistema.push('Token do Canvas expirou e precisa ser renovado na página PUC.');
      } else if (typeof sa.canvasToken.daysRemaining === 'number' && sa.canvasToken.daysRemaining <= 5) {
        alertasSistema.push(
          `Token do Canvas expira em ${sa.canvasToken.daysRemaining} dia${sa.canvasToken.daysRemaining === 1 ? '' : 's'}.`
        );
      }
    }
    // GitHub: não tem expiração — só avisa se houve erro real de autenticação (401/403)
    if (sa.githubToken?.configured && !sa.githubToken.decryptError && sa.githubToken.authError) {
      alertasSistema.push(`Token do GitHub retornou erro ${sa.githubToken.authError} de autenticação.`);
    }
    // Sync: só avisa se a última sincronização falhou nas últimas 24h (e não por decryptError local)
    if (sa.lastCanvasSync?.status === 'error' && !sa.canvasToken?.decryptError) {
      const syncTimeRaw = sa.lastCanvasSync.finished_at ?? sa.lastCanvasSync.started_at;
      const syncMs = syncTimeRaw ? new Date(syncTimeRaw).getTime() : NaN;
      const isRecent = Number.isNaN(syncMs) || now.getTime() - syncMs <= 24 * 3_600_000;
      if (isRecent) {
        alertasSistema.push('A última sincronização do Canvas falhou.');
      }
    }
    if (sa.pucAgent?.enabled && sa.pucAgent.paused) {
      alertasSistema.push(
        sa.pucAgent.quotaPausedReason
          ? `Agente da PUC pausado: ${sa.pucAgent.quotaPausedReason}.`
          : 'Agente da PUC está pausado.'
      );
    }
  }

  // ---- 5. Consolidate PUC Section (omit if completely empty) ----
  const cappedAtrasadas = capList(atrasadasAll, limit);
  const cappedHoje = capList(venceHojeAll, limit);
  const cappedAmanha = capList(venceAmanhaAll, limit);
  const cappedPrecisa = capList(precisaDeVoceAll, limit);
  const cappedNovidades = capList(novidadesAll, limit);

  const hasAnyPuc =
    cappedAtrasadas.kept.length > 0 ||
    cappedHoje.kept.length > 0 ||
    cappedAmanha.kept.length > 0 ||
    aVerificarAll.length > 0 ||
    prontasAll.length > 0 ||
    cappedPrecisa.kept.length > 0 ||
    cappedNovidades.kept.length > 0;

  const pucSection: BriefingPucSection | null = hasAnyPuc
    ? {
        atrasadas: cappedAtrasadas.kept,
        overflowAtrasadas: cappedAtrasadas.overflow,
        venceHoje: cappedHoje.kept,
        overflowVenceHoje: cappedHoje.overflow,
        venceAmanha: cappedAmanha.kept,
        overflowVenceAmanha: cappedAmanha.overflow,
        aVerificar: aVerificarAll.slice(0, limit),
        totalAVerificar: aVerificarAll.length,
        prontasParaEnviar: prontasAll.slice(0, limit),
        totalProntasParaEnviar: prontasAll.length,
        precisaDeVoce: cappedPrecisa.kept,
        overflowPrecisaDeVoce: cappedPrecisa.overflow,
        novidades: cappedNovidades.kept,
        overflowNovidades: cappedNovidades.overflow,
      }
    : null;

  // ---- 6. Deterministic "Foco do dia" (max 3 items) ----
  const focusCandidates: BriefingFocusItem[] = [];
  const focusSeen = new Set<string>();
  const addFocus = (id: string, titulo: string, motivo: string, prioridade: number) => {
    if (focusSeen.has(id)) return;
    focusSeen.add(id);
    focusCandidates.push({ id, titulo, motivo, prioridade });
  };

  // Atrasadas (prioridade altíssima)
  for (const item of atrasadasAll.slice(0, 2)) {
    const pts = item.pontos ? `, vale ${item.pontos} pontos` : '';
    addFocus(item.id, `${item.sigla}: ${item.nome}`, `atrasada${pts}`, 100 + (item.pontos || 0));
  }
  // Vencem hoje
  for (const item of venceHojeAll.slice(0, 3)) {
    const extra = item.detalhe ? `, ${item.detalhe}` : '';
    const pts = item.pontos ? `, ${item.pontos} pontos` : '';
    addFocus(
      item.id,
      `${item.sigla}: ${item.nome}`,
      `vence hoje${item.prazo ? ` às ${item.prazo}` : ''}${extra}${pts}`,
      90 + (item.pontos || 0)
    );
  }
  // Prontas para enviar (só falta subir no Canvas — ganho rápido)
  for (const item of prontasAll.slice(0, 2)) {
    addFocus(item.id, `Enviar ${item.sigla}: ${item.nome}`, 'pronta, só falta enviar no Canvas', 75);
  }
  // Precisa de você
  for (const item of precisaDeVoceAll.slice(0, 1)) {
    addFocus(item.id, `${item.sigla}: ${item.nome}`, 'agente aguarda sua decisão', 72);
  }
  // Vencem amanhã com peso alto ou prazo cedo
  for (const item of venceAmanhaAll.slice(0, 2)) {
    const pts = item.pontos ? `, ${item.pontos} pontos` : '';
    addFocus(
      item.id,
      `${item.sigla}: ${item.nome}`,
      `vence amanhã${item.prazo ? ` às ${item.prazo}` : ''}${pts}`,
      65 + (item.pontos || 0)
    );
  }
  // Conflito de agenda ou próximo evento
  if (agendaSection?.conflitos.length) {
    const c = agendaSection.conflitos[0];
    addFocus(`conflict:${c.a}:${c.b}`, `Resolver conflito às ${c.horario}`, `${c.a} e ${c.b}`, 80);
  } else if (agendaSection?.proximoEvento) {
    addFocus(
      `nextcal:${agendaSection.proximoEvento.titulo}`,
      agendaSection.proximoEvento.titulo,
      `compromisso às ${agendaSection.proximoEvento.horario}`,
      55
    );
  }
  // Tarefas atrasadas ou de hoje
  if (tarefasSection) {
    for (const t of tarefasSection.itens.slice(0, 2)) {
      addFocus(t.id, t.titulo, t.atrasada ? 'tarefa atrasada' : 'tarefa de hoje', t.atrasada ? 68 : 50);
    }
  }

  focusCandidates.sort((a, b) => b.prioridade - a.prioridade);
  const focoDoDia = focusCandidates.slice(0, 3);

  // ---- 7. Discrete Failure Notes (only when relevant) ----
  const sourceLabels: Record<string, string> = {
    weather: 'Clima indisponível agora.',
    calendar: 'Calendário indisponível agora.',
    puc: 'Dados da PUC indisponíveis agora.',
    tasks: 'Tarefas indisponíveis agora.',
  };
  const notasFalha = input.failedSources
    .map((src) => sourceLabels[src])
    .filter((note): note is string => Boolean(note));

  const sections: BriefingSections = {
    dateKey: todayKey,
    cabecalho: {
      saudacao: getGreeting(now),
      dataTexto: formatHeaderDate(now),
    },
    focoDoDia,
    clima: config.sections.weather && !input.failedSources.includes('weather') ? input.weather : null,
    agenda: agendaSection,
    puc: pucSection,
    alertasSistema,
    tarefas: tarefasSection,
    notasFalha,
  };

  return {
    sections,
    snapshot: {
      dateKey: todayKey,
      generatedAt: now.toISOString(),
      reportedNewsIds: Array.from(nextReportedNewsIds).slice(-500),
      assignmentSnapshots: nextAssignmentSnapshots,
    },
  };
}

// ---------- Text Sanitization & Validation ----------

const MARKDOWN_REGEX = /(^|\s)(#{1,6}\s|\*\*|__|`|```|\[.+?\]\(.+?\))|^\s*[-*•]\s+/m;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

export function stripMarkdownAndEmoji(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~#>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

export function validateBriefingText(
  raw: string,
  maxWords: number
): { ok: boolean; text: string; reason?: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: false, text: '', reason: 'empty' };
  if (MARKDOWN_REGEX.test(trimmed)) return { ok: false, text: '', reason: 'markdown_detected' };
  if (EMOJI_REGEX.test(trimmed)) return { ok: false, text: '', reason: 'emoji_detected' };

  const words = countWords(trimmed);
  if (words > maxWords) {
    return { ok: false, text: '', reason: `word_limit_exceeded:${words}>${maxWords}` };
  }
  return { ok: true, text: trimmed };
}

// ---------- Deterministic Template Renderers ----------

function formatWeatherOneLine(w: DetailedWeather): string {
  const parts: string[] = [
    `Clima: ${w.temperatureC} graus, ${w.description}, mínima de ${w.minC} e máxima de ${w.maxC}.`,
  ];
  const rainPeriods: string[] = [];
  if (typeof w.rainChance.manha === 'number' && w.rainChance.manha >= 30) {
    rainPeriods.push(`manhã ${w.rainChance.manha}%`);
  }
  if (typeof w.rainChance.tarde === 'number' && w.rainChance.tarde >= 30) {
    rainPeriods.push(`tarde ${w.rainChance.tarde}%`);
  }
  if (typeof w.rainChance.noite === 'number' && w.rainChance.noite >= 30) {
    rainPeriods.push(`noite ${w.rainChance.noite}%`);
  }
  if (rainPeriods.length > 0) {
    parts.push(`Chance de chuva: ${rainPeriods.join(', ')}.`);
  }
  if (w.windRelevant && w.windKmh) {
    parts.push(`Vento forte de até ${w.windKmh} km/h.`);
  }
  const advice: string[] = [];
  if (w.needsUmbrella) advice.push('leve guarda-chuva');
  if (w.needsJacket) advice.push('leve agasalho');
  if (advice.length > 0) {
    const joined = advice.join(' e ');
    parts.push(`${joined[0].toUpperCase()}${joined.slice(1)}.`);
  }
  return parts.join(' ');
}

function joinWithOverflow(items: string[], overflow: number): string {
  const base = items.join('; ');
  if (overflow > 0) return `${base} e mais ${overflow}`;
  return base;
}

export function renderDeterministicSpeech(
  sections: BriefingSections,
  opts: { aiUnavailableNotice?: boolean } = {}
): string {
  const blocks: string[] = [];

  // 1. Cabeçalho
  blocks.push(`${sections.cabecalho.saudacao}. ${sections.cabecalho.dataTexto}.`);

  // 2. Foco do dia (sempre primeiro após cabeçalho)
  if (sections.focoDoDia.length > 0) {
    const itens = sections.focoDoDia.map((f) => `${f.titulo}, ${f.motivo}`).join('; ');
    blocks.push(`Foco do dia: ${itens}.`);
  }

  // 3. Clima em uma frase curta
  if (sections.clima) {
    const w = sections.clima;
    const extras: string[] = [];
    if (w.needsUmbrella) extras.push('leve guarda-chuva');
    if (w.needsJacket) extras.push('leve agasalho');
    if (w.windRelevant && w.windKmh) extras.push(`vento de ${w.windKmh} km/h`);
    const extraTxt = extras.length ? `, ${extras.join(' e ')}` : '';
    blocks.push(`Clima: ${w.temperatureC} graus, mínima ${w.minC} e máxima ${w.maxC}${extraTxt}.`);
  }

  // 4. Agenda resumida
  if (sections.agenda) {
    const ag = sections.agenda;
    const agParts: string[] = [];
    if (ag.eventos.length > 0) {
      const top = ag.eventos.slice(0, 3).map((e) => `${e.titulo} às ${e.horario}`);
      const rem = ag.eventos.length - top.length + ag.overflowEventos;
      agParts.push(`Agenda: ${joinWithOverflow(top, rem)}.`);
    }
    if (ag.conflitos.length > 0) {
      agParts.push(`Atenção ao conflito às ${ag.conflitos[0].horario}.`);
    }
    if (ag.janelasLivres.length > 0) {
      const j = ag.janelasLivres[0];
      agParts.push(`Janela livre das ${j.inicio} às ${j.fim}.`);
    }
    if (ag.diaInteiro.length > 0 && ag.eventos.length === 0) {
      agParts.push(`Dia inteiro: ${ag.diaInteiro.slice(0, 2).join(', ')}.`);
    }
    if (agParts.length > 0) blocks.push(agParts.join(' '));
  }

  // 5. PUC entregas hoje/amanhã + contagens
  if (sections.puc) {
    const p = sections.puc;
    const pucParts: string[] = [];
    if (p.atrasadas.length > 0) {
      const top = p.atrasadas.slice(0, 2).map((i) => `${i.sigla} ${i.nome}`);
      const rem = p.atrasadas.length - top.length + p.overflowAtrasadas;
      pucParts.push(`PUC atrasadas: ${joinWithOverflow(top, rem)}.`);
    }
    if (p.venceHoje.length > 0) {
      const top = p.venceHoje.slice(0, 2).map((i) => `${i.sigla} ${i.nome}${i.prazo ? ` às ${i.prazo}` : ''}`);
      const rem = p.venceHoje.length - top.length + p.overflowVenceHoje;
      pucParts.push(`Vence hoje: ${joinWithOverflow(top, rem)}.`);
    }
    if (p.venceAmanha.length > 0) {
      const top = p.venceAmanha.slice(0, 2).map((i) => `${i.sigla} ${i.nome}${i.prazo ? ` às ${i.prazo}` : ''}`);
      const rem = p.venceAmanha.length - top.length + p.overflowVenceAmanha;
      pucParts.push(`Amanhã: ${joinWithOverflow(top, rem)}.`);
    }
    const counts: string[] = [];
    if (p.totalAVerificar > 0) counts.push(`${p.totalAVerificar} a verificar`);
    if (p.totalProntasParaEnviar > 0) counts.push(`${p.totalProntasParaEnviar} prontas para enviar`);
    if (p.precisaDeVoce.length > 0) counts.push(`${p.precisaDeVoce.length} precisando de você`);
    if (counts.length > 0) {
      pucParts.push(`Na PUC: ${counts.join(', ')}.`);
    }
    if (pucParts.length > 0) blocks.push(pucParts.join(' '));
  }

  // 6. Alertas do sistema
  if (sections.alertasSistema.length > 0) {
    blocks.push(`Alertas: ${sections.alertasSistema.slice(0, 2).join(' ')}`);
  }

  // 7. Notas de falha de fontes
  if (sections.notasFalha.length > 0) {
    blocks.push(sections.notasFalha.join(' '));
  }

  // 8. Aviso obrigatório quando nenhuma das 3 IAs estava disponível
  if (opts.aiUnavailableNotice) {
    blocks.push('Aviso: nenhuma IA estava disponível agora, resumo montado pelo sistema.');
  }

  return stripMarkdownAndEmoji(blocks.join('\n\n'));
}

export function renderDeterministicFull(
  sections: BriefingSections,
  opts: { aiUnavailableNotice?: boolean } = {}
): string {
  const blocks: string[] = [];

  blocks.push(`${sections.cabecalho.saudacao}. ${sections.cabecalho.dataTexto}.`);

  if (sections.focoDoDia.length > 0) {
    const linhas = sections.focoDoDia.map((f) => `${f.titulo} (${f.motivo})`).join('; ');
    blocks.push(`Foco do dia: ${linhas}.`);
  }

  if (sections.clima) {
    blocks.push(formatWeatherOneLine(sections.clima));
  }

  if (sections.agenda) {
    const ag = sections.agenda;
    const parts: string[] = [];
    if (ag.eventos.length > 0) {
      const list = ag.eventos.map(
        (e) => `${e.horario} ${e.titulo} (${e.duracao}${e.local ? `, em ${e.local}` : ''})`
      );
      parts.push(`Agenda: ${joinWithOverflow(list, ag.overflowEventos)}.`);
    }
    if (ag.proximoEvento) {
      parts.push(`Próximo: ${ag.proximoEvento.titulo} às ${ag.proximoEvento.horario}, ${ag.proximoEvento.emTexto}.`);
    }
    if (ag.conflitos.length > 0) {
      const confText = ag.conflitos.map((c) => `${c.a} e ${c.b} às ${c.horario}`).join('; ');
      parts.push(`Conflitos de horário: ${confText}.`);
    }
    if (ag.janelasLivres.length > 0) {
      const janText = ag.janelasLivres.map((j) => `das ${j.inicio} às ${j.fim} (${j.duracaoTexto})`).join(', ');
      parts.push(`Janelas livres para estudo: ${janText}.`);
    }
    if (ag.diaInteiro.length > 0) {
      parts.push(`Dia inteiro: ${ag.diaInteiro.join(', ')}.`);
    }
    if (parts.length > 0) blocks.push(parts.join(' '));
  }

  if (sections.puc) {
    const p = sections.puc;
    const parts: string[] = [];
    if (p.atrasadas.length > 0) {
      const list = p.atrasadas.map((i) => `${i.sigla} ${i.nome}${i.prazo ? ` (${i.diaRelativo} às ${i.prazo})` : ''}`);
      parts.push(`PUC atrasadas: ${joinWithOverflow(list, p.overflowAtrasadas)}.`);
    }
    if (p.venceHoje.length > 0) {
      const list = p.venceHoje.map((i) => `${i.sigla} ${i.nome}${i.prazo ? ` às ${i.prazo}` : ''}${i.detalhe ? `, ${i.detalhe}` : ''}`);
      parts.push(`PUC vence hoje: ${joinWithOverflow(list, p.overflowVenceHoje)}.`);
    }
    if (p.venceAmanha.length > 0) {
      const list = p.venceAmanha.map((i) => `${i.sigla} ${i.nome}${i.prazo ? ` às ${i.prazo}` : ''}${i.detalhe ? `, ${i.detalhe}` : ''}`);
      parts.push(`PUC vence amanhã: ${joinWithOverflow(list, p.overflowVenceAmanha)}.`);
    }
    if (p.totalAVerificar > 0) {
      const top = p.aVerificar.slice(0, 3).map((i) => `${i.sigla} ${i.nome}`);
      const rem = p.totalAVerificar - top.length;
      parts.push(`A verificar (${p.totalAVerificar}): ${joinWithOverflow(top, rem)}.`);
    }
    if (p.totalProntasParaEnviar > 0) {
      const top = p.prontasParaEnviar.slice(0, 3).map((i) => `${i.sigla} ${i.nome}`);
      const rem = p.totalProntasParaEnviar - top.length;
      parts.push(`Prontas para enviar (${p.totalProntasParaEnviar}): ${joinWithOverflow(top, rem)}.`);
    }
    if (p.precisaDeVoce.length > 0) {
      const list = p.precisaDeVoce.map((i) => `${i.sigla} ${i.nome} (${i.detalhe || 'aguarda decisão'})`);
      parts.push(`Precisa de você: ${joinWithOverflow(list, p.overflowPrecisaDeVoce)}.`);
    }
    if (p.novidades.length > 0) {
      const list = p.novidades.map((n) => n.texto);
      parts.push(`Novidades da PUC: ${joinWithOverflow(list, p.overflowNovidades)}.`);
    }
    if (parts.length > 0) blocks.push(parts.join(' '));
  }

  if (sections.tarefas && sections.tarefas.itens.length > 0) {
    const list = sections.tarefas.itens.map(
      (t) => `${t.titulo}${t.atrasada ? ' (atrasada)' : t.horario ? ` às ${t.horario}` : ''}`
    );
    blocks.push(`Tarefas: ${joinWithOverflow(list, sections.tarefas.overflow)}.`);
  }

  if (sections.alertasSistema.length > 0) {
    blocks.push(`Alertas do sistema: ${sections.alertasSistema.join(' ')}`);
  }

  if (sections.notasFalha.length > 0) {
    blocks.push(sections.notasFalha.join(' '));
  }

  if (opts.aiUnavailableNotice) {
    blocks.push('Aviso: nenhuma IA estava disponível agora, resumo montado automaticamente pelo sistema.');
  }

  return stripMarkdownAndEmoji(blocks.join('\n\n'));
}

export function buildBriefingPushPayload(sections: BriefingSections): {
  title: string;
  body: string;
  url: string;
} {
  const parts: string[] = [];
  if (sections.focoDoDia.length > 0) {
    parts.push(`Foco: ${sections.focoDoDia[0].titulo}`);
  }
  const counts: string[] = [];
  if (sections.puc) {
    const hojeTotal = sections.puc.venceHoje.length + sections.puc.overflowVenceHoje;
    const amanhaTotal = sections.puc.venceAmanha.length + sections.puc.overflowVenceAmanha;
    if (hojeTotal > 0) counts.push(`${hojeTotal} hoje`);
    if (amanhaTotal > 0) counts.push(`${amanhaTotal} amanhã`);
    if (sections.puc.totalAVerificar > 0) counts.push(`${sections.puc.totalAVerificar} a verificar`);
    if (sections.puc.totalProntasParaEnviar > 0) counts.push(`${sections.puc.totalProntasParaEnviar} prontas`);
  }
  if (counts.length > 0) {
    parts.push(`PUC: ${counts.join(', ')}`);
  } else if (sections.agenda && sections.agenda.eventos.length > 0) {
    parts.push(`${sections.agenda.eventos.length + sections.agenda.overflowEventos} evento(s) hoje`);
  }

  let body = parts.join(' · ') || `${sections.cabecalho.dataTexto}. Confira seu dia.`;
  body = stripMarkdownAndEmoji(body);
  if (body.length > 180) {
    body = `${body.slice(0, 177).trimEnd()}...`;
  }
  return {
    title: 'Bom dia',
    body,
    url: '/?page=puc',
  };
}
