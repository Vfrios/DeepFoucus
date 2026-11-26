import crypto from 'crypto';
import { classifyDeliveryStatus } from './canvasUtils';
import {
  AssignmentRecord,
  canGenerateForPart,
  DeliverableStatus,
  extractCanvasFileRefsFromHtml,
  normalizeDeliverableStatus,
  sanitizeHtmlToText,
} from './pucAssistantCore';

export type AgentRecordStatus =
  | 'novo_detectado'
  | 'na_fila'
  | 'gerando'
  | 'enviado_a_verificar'
  | 'verificado'
  | 'no_github'
  | 'precisa_de_voce'
  | 'ignorado'
  | 'erro';

export type AgentNotificationKind =
  | 'novo_trabalho'
  | 'a_verificar'
  | 'precisa_de_voce'
  | 'enunciado_mudou';

export interface PucAgentConfig {
  enabled: boolean;
  paused: boolean;
  activatedAt: Date | null;
  maxPerSync: number;
  maxPerDay: number;
  maxPerWeek: number;
  overdueToleranceDays: number;
  preferredProvider: 'auto' | 'gemini' | 'groq' | 'openrouter';
  courseOverrides: Record<string, { enabled: boolean }>;
}

export interface AgentAssignmentInput extends AssignmentRecord {
  quiz_id?: number | null;
  is_quiz_assignment?: boolean | null;
  external_tool_url?: string | null;
  created_at?: Date | string | null;
  first_seen_at?: Date | string | null;
  manual_submitted_override?: boolean | null;
  depends_on?: number | null;
}

export interface AgentCourseInput {
  canvas_id: number;
  name: string;
  hidden?: boolean;
  active?: boolean;
  ai_allowed?: boolean;
  assignments_count?: number;
  has_grades?: boolean;
}

export interface QuizDetectionResult {
  isHardQuiz: boolean;
  isPossibleQuiz: boolean;
  reason: string | null;
  signals: string[];
}

export type EligibilityOutcome = 'eligible' | 'queued' | 'ignored';

export interface EligibilityDecision {
  outcome: EligibilityOutcome;
  reasonCode: string;
  reasonLabel: string;
  isPossibleQuiz: boolean;
  signals?: string[];
}

export interface EvaluateEligibilityInput {
  assignment: AgentAssignmentInput;
  course: AgentCourseInput;
  config: PucAgentConfig;
  now?: Date;
  alwaysIgnore?: boolean;
  hasExistingDeliverable?: boolean;
  hasActiveJob?: boolean;
  dependsOnAssignment?: AssignmentRecord | null;
  deliverableStatus?: DeliverableStatus | null;
  generatedThisSync?: number;
  generatedToday?: number;
  generatedThisWeek?: number;
}

export interface AgentPushEvent {
  kind: AgentNotificationKind;
  courseAcronym: string;
  courseId: number;
  assignmentId: number;
  assignmentName: string;
  description?: string | null;
  dueAt?: Date | string | null;
  questionsTotal?: number;
  questionsOpen?: number;
  hasCrossword?: boolean;
  reason?: string | null;
}

export interface AgentPushPayload {
  title: string;
  body: string;
  url: string;
}

export const AGENT_STATUS_LABEL: Record<AgentRecordStatus, string> = {
  novo_detectado: 'Novo detectado',
  na_fila: 'Na fila',
  gerando: 'Gerando',
  enviado_a_verificar: 'Enviado a verificar',
  verificado: 'Verificado',
  no_github: 'No GitHub (verificado)',
  precisa_de_voce: 'Precisa de você',
  ignorado: 'Ignorado',
  erro: 'Erro',
};

export function getDefaultAgentConfig(): PucAgentConfig {
  const maxPerSync = Math.max(1, Math.min(20, Number(process.env.PUC_AGENT_MAX_PER_SYNC || 3) || 3));
  const maxPerDay = Math.max(1, Math.min(50, Number(process.env.PUC_AGENT_MAX_PER_DAY || 8) || 8));
  const maxPerWeek = Math.max(1, Math.min(200, Number(process.env.PUC_AGENT_MAX_PER_WEEK || 30) || 30));
  const overdueToleranceDays = Math.max(
    0,
    Math.min(60, Number(process.env.PUC_AGENT_OVERDUE_TOLERANCE_DAYS || 7) || 7)
  );
  return {
    enabled: false,
    paused: false,
    activatedAt: null,
    maxPerSync,
    maxPerDay,
    maxPerWeek,
    overdueToleranceDays,
    preferredProvider: 'auto',
    courseOverrides: {},
  };
}

/**
 * Hash determinístico do enunciado (texto limpo + referências de anexos no HTML).
 * Usado para detectar alterações relevantes no enunciado após geração.
 */
export function computeStatementHash(description: string | null | undefined): string {
  const cleanText = sanitizeHtmlToText(description, 40_000)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const refs = extractCanvasFileRefsFromHtml(description)
    .map((r) => `${r.fileId}:${r.label.toLowerCase()}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(`${cleanText}::${refs}`, 'utf8').digest('hex');
}

const NON_ONLINE_SUBMISSION_TYPES = new Set(['none', 'on_paper', 'not_graded']);
const PROCTORING_REGEX =
  /\b(proctor|proctoring|proctorio|respondus|lockdown|examity|honorlock|safe\s*exam|seb|monitoramento\s+de\s+prova)\b/i;
const QUIZ_NAME_REGEX =
  /\b(prova|provas|quiz|quizzes|avalia[cç][aã]o|avaliacoes|teste|exame|simulado|p1|p2|p3|p4|av1|av2|av3)\b/i;

/**
 * Filtro (a): detecção de prova/quiz.
 * Prioriza sinais estruturais do Canvas. Nome isolado NUNCA descarta silenciosamente —
 * retorna `isPossibleQuiz: true` ("ignorado: possível prova") para revisão do usuário.
 */
export function detectQuizOrExamSignal(assignment: AgentAssignmentInput): QuizDetectionResult {
  const types = Array.isArray(assignment.submission_types)
    ? assignment.submission_types.map((t) => String(t).toLowerCase())
    : [];
  const signals: string[] = [];

  if (types.includes('online_quiz')) {
    signals.push('submission_types:online_quiz');
  }
  if (typeof assignment.quiz_id === 'number' && assignment.quiz_id > 0) {
    signals.push('quiz_id');
  }
  if (assignment.is_quiz_assignment === true) {
    signals.push('is_quiz_assignment');
  }
  if (types.includes('external_tool')) {
    const toolHaystack = `${assignment.external_tool_url || ''} ${sanitizeHtmlToText(assignment.description, 2000)}`;
    if (PROCTORING_REGEX.test(toolHaystack)) {
      signals.push('external_tool:proctoring');
    }
  }
  const hasOnlyNonOnline = types.length > 0 && types.every((t) => NON_ONLINE_SUBMISSION_TYPES.has(t));
  if (hasOnlyNonOnline) {
    signals.push(`submission_types:${types.join(',')}`);
  }
  const hasOnlineType = types.some((t) => !NON_ONLINE_SUBMISSION_TYPES.has(t));
  if (assignment.locked_for_user && !hasOnlineType) {
    signals.push('locked_for_user_sem_entrega_online');
  }

  if (signals.length > 0) {
    return {
      isHardQuiz: true,
      isPossibleQuiz: false,
      reason: `Prova/quiz ou atividade sem entrega online (${signals.join(', ')})`,
      signals,
    };
  }

  // Sinal fraco: apenas o nome parece prova/quiz (ex.: "Lista prova 3")
  const nameText = String(assignment.name || '');
  if (QUIZ_NAME_REGEX.test(nameText)) {
    return {
      isHardQuiz: false,
      isPossibleQuiz: true,
      reason: 'ignorado: possível prova (apenas sinal no nome — clique em "Gerar mesmo assim" se for entregável)',
      signals: ['name_only'],
    };
  }

  return {
    isHardQuiz: false,
    isPossibleQuiz: false,
    reason: null,
    signals: [],
  };
}

function toSafeDate(val: Date | string | null | undefined): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Avalia elegibilidade de um trabalho na ordem exata de proteção de cota:
 * - Pré-checagens: agente desligado/pausado, ignorar sempre, primeira ativação sem retroativo
 * - (a) Prova/quiz (estrutural vs possível prova por nome)
 * - (b) Sem data de entrega (due_at nulo)
 * - (c) Sem pontos (points_possible nulo ou 0)
 * - (d) Já entregue, corrigido, dispensado ou override manual de entregue
 * - (e) Prazo vencido há mais de N dias (configurável, padrão 7)
 * - (f) Já existe entrega gerada ou job em andamento (idempotência)
 * - (g) Parte de projeto multi-parte bloqueada pelo gate
 * - (h) Curso oculto, inativo, sem atividade ou IA/agente desligado no curso
 * - (i) Limites de custo por sync / dia / semana -> excedente fica "na_fila"
 */
export function evaluateAssignmentEligibility(input: EvaluateEligibilityInput): EligibilityDecision {
  const now = input.now ?? new Date();
  const { assignment, course, config } = input;

  if (!config.enabled) {
    return {
      outcome: 'ignored',
      reasonCode: 'agent_disabled',
      reasonLabel: 'Agente global desligado',
      isPossibleQuiz: false,
    };
  }

  if (config.paused) {
    return {
      outcome: 'queued',
      reasonCode: 'agent_paused',
      reasonLabel: 'Agente pausado — mantido na fila',
      isPossibleQuiz: false,
    };
  }

  if (input.alwaysIgnore) {
    return {
      outcome: 'ignored',
      reasonCode: 'always_ignore',
      reasonLabel: 'Marcado para ignorar sempre pelo usuário',
      isPossibleQuiz: false,
    };
  }

  // Primeira ativação: não gerar retroativamente trabalhos anteriores à data de ativação
  const activatedAt = toSafeDate(config.activatedAt);
  if (activatedAt) {
    const refDate = toSafeDate(assignment.created_at) || toSafeDate(assignment.first_seen_at);
    if (refDate && refDate.getTime() < activatedAt.getTime()) {
      return {
        outcome: 'ignored',
        reasonCode: 'before_activation',
        reasonLabel: 'Criado antes da ativação do agente (sem geração retroativa)',
        isPossibleQuiz: false,
      };
    }
  }

  // (a) Prova ou quiz
  const quiz = detectQuizOrExamSignal(assignment);
  if (quiz.isHardQuiz) {
    return {
      outcome: 'ignored',
      reasonCode: 'quiz_or_non_online',
      reasonLabel: quiz.reason || 'Prova/quiz detectado por sinal estrutural',
      isPossibleQuiz: false,
      signals: quiz.signals,
    };
  }
  if (quiz.isPossibleQuiz) {
    return {
      outcome: 'ignored',
      reasonCode: 'possible_quiz',
      reasonLabel: 'ignorado: possível prova',
      isPossibleQuiz: true,
      signals: quiz.signals,
    };
  }

  // (b) Sem data de entrega
  const dueAt = toSafeDate(assignment.due_at);
  if (!dueAt) {
    return {
      outcome: 'ignored',
      reasonCode: 'no_due_date',
      reasonLabel: 'Sem data de entrega (due_at nulo)',
      isPossibleQuiz: false,
    };
  }

  // (c) Sem pontos
  if (typeof assignment.points_possible !== 'number' || assignment.points_possible <= 0) {
    return {
      outcome: 'ignored',
      reasonCode: 'no_points',
      reasonLabel: 'Sem pontuação (points_possible nulo ou 0)',
      isPossibleQuiz: false,
    };
  }

  // (d) Já entregue, corrigido ou dispensado no Canvas ou override manual
  if (assignment.manual_submitted_override) {
    return {
      outcome: 'ignored',
      reasonCode: 'manual_submitted_override',
      reasonLabel: 'Marcado manualmente como entregue',
      isPossibleQuiz: false,
    };
  }
  const deliveryStatus = classifyDeliveryStatus(assignment, now);
  if (deliveryStatus === 'entregue' || deliveryStatus === 'corrigido' || deliveryStatus === 'dispensado') {
    return {
      outcome: 'ignored',
      reasonCode: `already_${deliveryStatus}`,
      reasonLabel: `Trabalho já ${deliveryStatus} no Canvas`,
      isPossibleQuiz: false,
    };
  }

  // (e) Prazo já vencido há mais de N dias
  const toleranceDays = Math.max(0, Number(config.overdueToleranceDays ?? 7));
  const overdueMs = now.getTime() - dueAt.getTime();
  if (overdueMs > toleranceDays * 24 * 60 * 60 * 1000) {
    const daysLate = Math.floor(overdueMs / (24 * 60 * 60 * 1000));
    return {
      outcome: 'ignored',
      reasonCode: 'overdue_too_old',
      reasonLabel: `Prazo vencido há ${daysLate} dia(s) (tolerância: ${toleranceDays}d)`,
      isPossibleQuiz: false,
    };
  }

  // (f) Idempotência por assignment_id
  if (input.hasExistingDeliverable || input.hasActiveJob) {
    return {
      outcome: 'ignored',
      reasonCode: input.hasActiveJob ? 'job_in_progress' : 'already_generated',
      reasonLabel: input.hasActiveJob
        ? 'Já existe um job em andamento para este trabalho'
        : 'Já existe entrega gerada para este trabalho',
      isPossibleQuiz: false,
    };
  }

  // (g) Parte de projeto multi-parte bloqueada pelo gate
  if (assignment.assignment_kind === 'multi_part' && typeof assignment.depends_on === 'number') {
    const gate = canGenerateForPart({
      assignment,
      dependsOnAssignment: input.dependsOnAssignment ?? null,
      deliverableStatus: input.deliverableStatus ?? null,
      now,
    });
    if (!gate.allowed) {
      return {
        outcome: 'ignored',
        reasonCode: 'multipart_gate_blocked',
        reasonLabel: gate.reason || 'Parte anterior do projeto ainda não corrigida no Canvas',
        isPossibleQuiz: false,
      };
    }
  }

  // (h) Curso oculto, inativo, sem atividade ou IA/agente desligado no curso
  if (course.hidden) {
    return {
      outcome: 'ignored',
      reasonCode: 'course_hidden',
      reasonLabel: 'Curso oculto',
      isPossibleQuiz: false,
    };
  }
  if (course.active === false || course.has_grades === false) {
    return {
      outcome: 'ignored',
      reasonCode: 'course_inactive',
      reasonLabel: 'Curso inativo ou sem atividades avaliativas',
      isPossibleQuiz: false,
    };
  }
  if (course.ai_allowed === false) {
    return {
      outcome: 'ignored',
      reasonCode: 'course_ai_disabled',
      reasonLabel: 'IA permitida desligada neste curso',
      isPossibleQuiz: false,
    };
  }
  const courseOverride = config.courseOverrides?.[String(course.canvas_id)];
  if (courseOverride && courseOverride.enabled === false) {
    return {
      outcome: 'ignored',
      reasonCode: 'course_agent_disabled',
      reasonLabel: 'Agente desligado para este curso',
      isPossibleQuiz: false,
    };
  }

  // (i) Limites de custo (sync / dia / semana) -> excedente vai para a fila sem perder
  const genSync = input.generatedThisSync ?? 0;
  const genDay = input.generatedToday ?? 0;
  const genWeek = input.generatedThisWeek ?? 0;

  if (genSync >= config.maxPerSync) {
    return {
      outcome: 'queued',
      reasonCode: 'quota_sync_limit',
      reasonLabel: `Na fila: limite de ${config.maxPerSync} geração(ões) por sync atingido`,
      isPossibleQuiz: false,
    };
  }
  if (genDay >= config.maxPerDay) {
    return {
      outcome: 'queued',
      reasonCode: 'quota_day_limit',
      reasonLabel: `Na fila: limite diário de ${config.maxPerDay} geração(ões) atingido`,
      isPossibleQuiz: false,
    };
  }
  if (genWeek >= config.maxPerWeek) {
    return {
      outcome: 'queued',
      reasonCode: 'quota_week_limit',
      reasonLabel: `Na fila: limite semanal de ${config.maxPerWeek} geração(ões) atingido`,
      isPossibleQuiz: false,
    };
  }

  return {
    outcome: 'eligible',
    reasonCode: 'eligible',
    reasonLabel: 'Elegível para geração automática',
    isPossibleQuiz: false,
  };
}

/**
 * Ordena candidatos elegíveis priorizando prazo mais próximo.
 */
export function sortCandidatesByDueDate<T extends { due_at?: Date | string | null; canvas_id: number }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const da = toSafeDate(a.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = toSafeDate(b.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.canvas_id - b.canvas_id;
  });
}

// ---- Resumo ultra-curto e notificações Web Push (máx. ~140 chars, sem chamada cara de IA) ----

export const MAX_PUSH_BODY_CHARS = 140;

function formatShortDueDate(dueAt: Date | string | null | undefined): string {
  const d = toSafeDate(dueAt);
  if (!d) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}

function truncatePushText(text: string, maxLen = MAX_PUSH_BODY_CHARS): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

/**
 * Gera resumo determinístico ultra-curto (<= 140 chars) do que é pedido + prazo curto.
 * Nunca gasta chamada de IA para notificação.
 */
export function buildUltraShortAssignmentSpec(event: {
  assignmentName: string;
  description?: string | null;
  dueAt?: Date | string | null;
  questionsTotal?: number;
  questionsOpen?: number;
  hasCrossword?: boolean;
}): string {
  const dueShort = formatShortDueDate(event.dueAt);
  const dueSuffix = dueShort ? `. Vence ${dueShort}` : '';
  const parts: string[] = [];

  if (typeof event.questionsTotal === 'number' && event.questionsTotal > 0) {
    let qPart = `Lista de ${event.questionsTotal} questões`;
    if (typeof event.questionsOpen === 'number' && event.questionsOpen > 0) {
      qPart += ` + ${event.questionsOpen} aberta(s)`;
    }
    if (event.hasCrossword) {
      qPart += ' + cruzada';
    }
    parts.push(qPart);
  } else {
    const cleanName = String(event.assignmentName || 'Trabalho').replace(/\s+/g, ' ').trim();
    const desc = sanitizeHtmlToText(event.description, 400).replace(/\s+/g, ' ').trim();
    if (desc && desc.length >= 12 && !desc.toLowerCase().startsWith(cleanName.toLowerCase())) {
      const firstSentence = desc.split(/(?<=[.!?])\s+/)[0] || desc;
      parts.push(`${cleanName}: ${firstSentence}`);
    } else {
      parts.push(cleanName);
    }
  }

  const maxSpecLen = Math.max(20, MAX_PUSH_BODY_CHARS - dueSuffix.length);
  const spec = truncatePushText(parts.join(' '), maxSpecLen);
  return truncatePushText(`${spec}${dueSuffix}`, MAX_PUSH_BODY_CHARS);
}

export function buildAgentNotificationPayload(event: AgentPushEvent): AgentPushPayload {
  const acronym = (event.courseAcronym || 'PUC').trim().toUpperCase().slice(0, 12);
  const url = `/?page=puc&courseId=${event.courseId}&assignmentId=${event.assignmentId}`;

  if (event.kind === 'a_verificar') {
    const spec = buildUltraShortAssignmentSpec(event);
    return {
      title: `[${acronym}] a verificar`,
      body: truncatePushText(spec, MAX_PUSH_BODY_CHARS),
      url,
    };
  }

  if (event.kind === 'precisa_de_voce') {
    const detail = event.reason
      ? `${event.assignmentName}: ${event.reason}`
      : `${event.assignmentName}: requer sua revisão`;
    return {
      title: `[${acronym}] precisa de você`,
      body: truncatePushText(detail, MAX_PUSH_BODY_CHARS),
      url,
    };
  }

  if (event.kind === 'enunciado_mudou') {
    const dueShort = formatShortDueDate(event.dueAt);
    const body = `${event.assignmentName} foi alterado no Canvas${dueShort ? ` (vence ${dueShort})` : ''}. Abra para regerar.`;
    return {
      title: `[${acronym}] enunciado mudou`,
      body: truncatePushText(body, MAX_PUSH_BODY_CHARS),
      url,
    };
  }

  // novo_trabalho
  return {
    title: `[${acronym}] novo trabalho`,
    body: buildUltraShortAssignmentSpec(event),
    url,
  };
}

/**
 * Agrupa eventos do mesmo sync em NO MÁXIMO 1 Web Push.
 */
export function buildGroupedAgentSyncPush(events: AgentPushEvent[]): AgentPushPayload | null {
  if (!Array.isArray(events) || events.length === 0) return null;
  if (events.length === 1) {
    return buildAgentNotificationPayload(events[0]);
  }

  const acronyms = Array.from(
    new Set(events.map((e) => (e.courseAcronym || 'PUC').trim().toUpperCase().slice(0, 10)))
  );
  const tag = acronyms.length === 1 ? `[${acronyms[0]}]` : `[PUC]`;

  const allChanged = events.every((e) => e.kind === 'enunciado_mudou');
  const title = allChanged
    ? `${tag} ${events.length} enunciados mudaram`
    : `${tag} ${events.length} novidades no agente`;

  const summaryItems = events.slice(0, 3).map((e) => {
    const due = formatShortDueDate(e.dueAt);
    const prefix = acronyms.length > 1 ? `${e.courseAcronym}: ` : '';
    const suffix = e.kind === 'enunciado_mudou' ? ' (mudou)' : due ? ` (${due})` : '';
    return `${prefix}${e.assignmentName}${suffix}`;
  });
  const extra = events.length > 3 ? ` +${events.length - 3}` : '';
  const body = truncatePushText(`${summaryItems.join(' · ')}${extra}`, MAX_PUSH_BODY_CHARS);

  // Abre direto no primeiro trabalho (mais urgente)
  const first = events[0];
  return {
    title,
    body,
    url: `/?page=puc&courseId=${first.courseId}&assignmentId=${first.assignmentId}`,
  };
}

// ---- Estimativa determinística de custo por provedor/modelo ----

/**
 * Estimativa conservadora de custo em USD por geração (baseada em ~4 chars/token).
 */
export function estimateAiCostUsd(params: {
  provider: string;
  model: string;
  inputChars: number;
  outputChars: number;
}): number {
  const inputTokens = Math.max(1, Math.ceil((params.inputChars || 0) / 4));
  const outputTokens = Math.max(1, Math.ceil((params.outputChars || 0) / 4));
  const prov = (params.provider || '').toLowerCase();
  const mdl = (params.model || '').toLowerCase();

  // Preços aproximados por 1M tokens (USD)
  let inPerM = 0.15;
  let outPerM = 0.6;

  if (prov === 'gemini') {
    if (mdl.includes('pro')) {
      inPerM = 1.25;
      outPerM = 5.0;
    } else {
      // flash / flash-lite
      inPerM = 0.1;
      outPerM = 0.4;
    }
  } else if (prov === 'groq') {
    inPerM = 0.08;
    outPerM = 0.24;
  } else if (prov === 'openrouter') {
    if (mdl.includes(':free')) {
      inPerM = 0;
      outPerM = 0;
    } else {
      inPerM = 0.2;
      outPerM = 0.8;
    }
  }

  const usd = (inputTokens / 1_000_000) * inPerM + (outputTokens / 1_000_000) * outPerM;
  return Number(usd.toFixed(6));
}

/**
 * Mapeia o status do deliverable + contexto do agente para o estado unificado do fluxo.
 */
export function resolveDeliverableWorkflowLabel(status: DeliverableStatus | string | null | undefined): string {
  const norm = normalizeDeliverableStatus(status);
  if (norm === 'enviado_a_verificar') return 'Enviado a verificar';
  if (norm === 'validada') return 'Verificado';
  if (norm === 'entrega_gerada') return 'No GitHub (verificado)';
  if (norm === 'revisada_por_mim') return 'Revisada por mim';
  return 'Rascunho';
}
