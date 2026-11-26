import { classifyDeliveryStatus, formatSaoPauloDateTime, normalizeText } from './canvasUtils';

export type AssignmentKind = 'multi_part' | 'one_shot';

export type DeliverableStatus =
  | 'rascunho'
  | 'enviado_a_verificar'
  | 'revisada_por_mim'
  | 'validada'
  | 'entrega_gerada';

export type AssignmentDeliveryFormat = 'manuscrito' | 'digitado' | 'codigo' | 'link' | 'arquivo';

export type PartTimelineState =
  | 'bloqueada'
  | 'liberada'
  | 'entrega_gerada'
  | 'em_revisao'
  | 'enviada_por_mim'
  | 'aguardando_correcao'
  | 'corrigida';

export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  rascunho: 'Rascunho',
  enviado_a_verificar: 'Enviado a verificar',
  revisada_por_mim: 'Revisada por mim',
  validada: 'Verificado',
  entrega_gerada: 'No GitHub (verificado)',
};

/**
 * Normaliza status legados ('pronta' -> 'validada') para o ciclo atual:
 * rascunho / enviado_a_verificar -> revisada_por_mim -> validada (verificado) -> entrega_gerada (no GitHub)
 */
export function normalizeDeliverableStatus(raw: unknown): DeliverableStatus {
  if (
    raw === 'rascunho' ||
    raw === 'enviado_a_verificar' ||
    raw === 'revisada_por_mim' ||
    raw === 'validada' ||
    raw === 'entrega_gerada'
  ) {
    return raw;
  }
  if (raw === 'pronta' || raw === 'verificado') return 'validada';
  return 'rascunho';
}

export const PART_TIMELINE_LABEL: Record<PartTimelineState, string> = {
  bloqueada: 'Bloqueada',
  liberada: 'Liberada',
  entrega_gerada: 'Entrega gerada',
  em_revisao: 'Em revisão',
  enviada_por_mim: 'Enviada por mim',
  aguardando_correcao: 'Aguardando correção',
  corrigida: 'Corrigida',
};

export interface SubmissionCommentData {
  author_name?: string | null;
  comment?: string | null;
  created_at?: Date | string | null;
}

export interface RubricCriterionData {
  id?: string | null;
  description: string;
  long_description?: string;
  points: number;
}

export interface RubricAssessmentEntryData {
  points?: number | null;
  comments?: string | null;
}

export interface AssignmentRecord {
  canvas_id: number;
  course_id: number;
  course_name?: string;
  name: string;
  description?: string | null;
  due_at?: Date | string | null;
  lock_at?: Date | string | null;
  locked_for_user?: boolean | null;
  points_possible?: number | null;
  html_url?: string | null;
  submission_types?: string[];
  group_category_id?: number | null;
  workflow_state?: string | null;
  submitted_at?: Date | string | null;
  submission_body?: string | null;
  score?: number | null;
  grade?: string | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean;
  attachments?: Array<{ id?: number | null; display_name: string; size?: number; content_type?: string }>;
  rubric?: RubricCriterionData[];
  submission_comments?: SubmissionCommentData[];
  rubric_assessment?: Record<string, RubricAssessmentEntryData> | null;
  assignment_kind?: AssignmentKind;
  assignment_kind_manual?: boolean;
  project_id?: string | null;
}

export interface ProjectPartSpec {
  assignment_id: number;
  name: string;
  order: number;
  depends_on: number | null;
  due_at: Date | null;
  suggested_start_at: Date | null;
  suggested_review_at: Date | null;
}

export interface MultiPartProjectSpec {
  project_id: string;
  course_id: number;
  course_name: string;
  title: string;
  manual?: boolean;
  parts: ProjectPartSpec[];
}

export interface AssignmentClassificationResult {
  classifications: Map<
    number,
    {
      assignment_kind: AssignmentKind;
      project_id: string | null;
      part_order: number | null;
      depends_on: number | null;
    }
  >;
  projects: MultiPartProjectSpec[];
}

export interface CourseLessonSummary {
  course_id: number;
  course_name: string;
  charged_points: string[];
  recurring_issues: string[];
  strengths: string[];
  raw_notes: string[];
  updated_at: Date;
}

export interface ContextPageInput {
  title: string;
  body?: string | null;
  html_url?: string | null;
}

export interface ContextFileInput {
  display_name: string;
  origin_path?: string;
  extracted_text?: string;
}

export interface ExtractedAttachmentText {
  fileId?: number;
  name: string;
  contentType: string;
  text: string;
  pages?: number;
  charsExtracted?: number;
  status?: 'ok' | 'empty' | 'error' | 'too_large';
  error?: string;
  truncated?: boolean;
  needsVision?: boolean;
  visionReason?: string | null;
}

export interface DetectedQuestionsSummary {
  total: number;
  closed: number;
  open: number;
  other: number;
  questionNumbers: number[];
  hasCrosswordOrGrid: boolean;
  hasFiguresOrTables: boolean;
}

export interface CompletenessCheckResult {
  expectedCount: number;
  answeredCount: number;
  expectedNumbers: number[];
  answeredNumbers: number[];
  missingNumbers: number[];
  passed: boolean;
}

export interface TitleDivergenceResult {
  hasDivergence: boolean;
  reason: string | null;
  detectedAttachmentTitle: string | null;
}

export interface GenerationSourceRef {
  kind: 'enunciado' | 'anexo' | 'visao_pdf' | 'pagina_curso' | 'arquivo_curso' | 'entrega_anterior' | 'meu_projeto' | 'licoes_professor' | 'enunciado_manual';
  label: string;
  detail?: string;
}

export interface UnderstandingAttachmentItem {
  fileId?: number;
  name: string;
  contentType: string;
  pages: number;
  charsExtracted: number;
  status: 'ok' | 'empty' | 'error' | 'too_large';
  needsVision: boolean;
  visionReason?: string | null;
  error?: string;
}

export interface UnderstandingSummary {
  assignmentId: number;
  assignmentName: string;
  courseId: number;
  courseName: string;
  submissionTypes: string[];
  detectedFormat: AssignmentDeliveryFormat;
  isHandwritten: boolean;
  handwrittenKeywords: string[];
  isGroup: boolean;
  dueAt: string | null;
  pointsPossible: number | null;
  hasRubric: boolean;
  attachments: UnderstandingAttachmentItem[];
  questions: DetectedQuestionsSummary;
  titleDivergence: TitleDivergenceResult;
  unreadableAttachments: boolean;
  needsVision: boolean;
  canProceed: boolean;
  blockReason: string | null;
  sourcesPreview: GenerationSourceRef[];
}

export interface PreviousSubmissionInput {
  assignment_id: number;
  name: string;
  submitted_at?: Date | string | null;
  score?: number | null;
  points_possible?: number | null;
  grade?: string | null;
  submitted_text?: string | null;
  attachments_text?: ExtractedAttachmentText[];
  comments?: SubmissionCommentData[];
  rubric_assessment?: Record<string, RubricAssessmentEntryData> | null;
  rubric?: RubricCriterionData[];
}

export interface PreviousPartApprovedInput {
  assignment_id: number;
  name: string;
  approved_markdown?: string | null;
  score?: number | null;
  points_possible?: number | null;
  grade?: string | null;
  comments?: SubmissionCommentData[];
  rubric_assessment?: Record<string, RubricAssessmentEntryData> | null;
}

export interface BuildContextInput {
  courseName: string;
  assignment: AssignmentRecord;
  assignmentAttachments?: ExtractedAttachmentText[];
  manualStatement?: string | null;
  myProject?: string | null;
  coursePages?: ContextPageInput[];
  courseFiles?: ContextFileInput[];
  previousSubmissions?: PreviousSubmissionInput[];
  previousPartApproved?: PreviousPartApprovedInput | null;
  teacherLessons?: CourseLessonSummary | null;
  groupMembers?: string[];
  studentName?: string | null;
  isHandwritten?: boolean;
  isGroup?: boolean;
  detectedQuestions?: DetectedQuestionsSummary | null;
  visionPagesUsed?: number;
  maxContextChars?: number;
}

export interface BuiltDeliverableContext {
  assignmentId: number;
  assignmentName: string;
  promptDataBlock: string;
  totalChars: number;
  preferLongContextModel: boolean;
  includedMaterialsCount: number;
  includedPreviousCount: number;
  expectsCode: boolean;
  hasRubric: boolean;
  isHandwritten: boolean;
  isGroup: boolean;
  detectedQuestions: DetectedQuestionsSummary;
  usedSources: GenerationSourceRef[];
}

export interface ExportGateResult {
  allowed: boolean;
  reasons: string[];
  pendingPlaceholders: string[];
}

export interface ExtractedCodeFile {
  path: string;
  language: string;
  content: string;
}

const DEFAULT_MAX_CONTEXT_CHARS = 48_000;
export const LONG_CONTEXT_THRESHOLD_CHARS = 22_000;

/**
 * Sanitiza HTML do Canvas para texto limpo preservando quebras estruturais.
 */
export function sanitizeHtmlToText(html: string | null | undefined, maxLen = 12_000): string {
  if (!html) return '';
  const cleaned = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}\n[... conteúdo resumido por limite de tamanho ...]`;
}

/**
 * Neutraliza tentativas de fechar o bloco de dados não confiáveis (anti prompt injection).
 */
export function wrapUntrustedData(label: string, content: string): string {
  const safeContent = String(content || '')
    .replace(/<\/?DADOS_NAO_CONFIAVEIS[^>]*>/gi, '[TAG_REMOVIDA]')
    .trim();
  return `<DADOS_NAO_CONFIAVEIS fonte="${label}">\n${safeContent || '(vazio)'}\n</DADOS_NAO_CONFIAVEIS>`;
}

/**
 * Extrai marcadores `[PREENCHER: ...]` (ou `[PREENCHER]`) pendentes no texto final.
 */
export function findPendingPlaceholders(markdown: string): string[] {
  const text = String(markdown || '');
  const matches = text.match(/\[PREENCHER(?:\s*:[^\]]*)?\]/gi) || [];
  return matches.map((m) => m.trim());
}

/**
 * Regra rígida de validação: sem [PREENCHER] pendente, conteúdo não vazio e checagem de completude aprovada.
 */
export function canValidateDeliverable(
  markdown: string,
  completeness?: CompletenessCheckResult | null
): ExportGateResult {
  const pendingPlaceholders = findPendingPlaceholders(markdown);
  const reasons: string[] = [];

  if (!String(markdown || '').trim()) {
    reasons.push('O conteúdo da entrega está vazio.');
  }
  if (pendingPlaceholders.length > 0) {
    reasons.push(
      `Existem ${pendingPlaceholders.length} marcador(es) [PREENCHER] pendente(s) que precisam ser completados antes de validar.`
    );
  }
  if (completeness && completeness.expectedCount > 0 && !completeness.passed) {
    reasons.push(
      `Checagem de completude pendente: faltam resposta(s) para a(s) questão(ões) ${completeness.missingNumbers.join(', ')}.`
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    pendingPlaceholders,
  };
}

/**
 * Regra rígida de publicação no GitHub: somente entregas com status 'validada',
 * sem [PREENCHER] pendente e que passaram pela checagem de completude.
 */
export function canPublishDeliverable(
  status: DeliverableStatus | string | null | undefined,
  markdown: string,
  completeness?: CompletenessCheckResult | null
): ExportGateResult {
  const normStatus = normalizeDeliverableStatus(status);
  const base = canValidateDeliverable(markdown, completeness);
  const reasons = [...base.reasons];

  if (normStatus !== 'validada') {
    reasons.unshift(
      normStatus === 'entrega_gerada'
        ? 'Esta versão já foi publicada como "Entrega gerada". Edite e valide novamente para publicar uma nova versão.'
        : 'A entrega precisa ser validada ("Validada (pronta)") manualmente por você antes de salvar no GitHub.'
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    pendingPlaceholders: base.pendingPlaceholders,
  };
}

/**
 * Regra rígida de exportação: libera PDF/download final quando status === 'validada' ou 'entrega_gerada'
 * (ou legado 'pronta'), sem nenhum marcador `[PREENCHER: ...]` pendente e com completude aprovada.
 */
export function canExportDeliverable(
  status: DeliverableStatus | string | null | undefined,
  markdown: string,
  completeness?: CompletenessCheckResult | null
): ExportGateResult {
  const normStatus = normalizeDeliverableStatus(status);
  const base = canValidateDeliverable(markdown, completeness);
  const reasons = [...base.reasons];

  if (normStatus !== 'validada' && normStatus !== 'entrega_gerada') {
    reasons.unshift('A entrega precisa ser revisada e marcada como "Validada (pronta)" antes de exportar.');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    pendingPlaceholders: base.pendingPlaceholders,
  };
}

/**
 * Transição determinística ao editar o texto:
 * - Editar uma entrega já 'entrega_gerada', 'validada' ou 'rascunho' volta o status para 'revisada_por_mim'.
 */
export function transitionStatusOnEdit(
  currentStatus: DeliverableStatus | string | null | undefined,
  prevMarkdown: string,
  nextMarkdown: string
): DeliverableStatus {
  const norm = normalizeDeliverableStatus(currentStatus);
  if (prevMarkdown !== nextMarkdown) {
    return 'revisada_por_mim';
  }
  return norm;
}

/**
 * Transição determinística após tentativa de commit no GitHub:
 * - Só muda para 'entrega_gerada' após o commit ser confirmado;
 * - Se falhar, mantém 'validada'.
 */
export function transitionStatusAfterGithubCommit(
  currentStatus: DeliverableStatus | string | null | undefined,
  commitSucceeded: boolean
): DeliverableStatus {
  const norm = normalizeDeliverableStatus(currentStatus);
  if (commitSucceeded) return 'entrega_gerada';
  return norm === 'validada' ? 'validada' : norm;
}

/**
 * Indica se o trabalho está pronto para envio manual no Canvas:
 * entrega já publicada ('entrega_gerada') enquanto o Canvas ainda reporta 'pendente' ou 'atrasado'.
 * Assim que o sync detectar 'entregue' ou 'corrigido', deixa de contar como "pronta para enviar".
 */
export function isReadyToSubmitInCanvas(
  deliverableStatus: DeliverableStatus | string | null | undefined,
  canvasDeliveryStatus: string | null | undefined
): boolean {
  if (deliverableStatus !== 'entrega_gerada') return false;
  return canvasDeliveryStatus === 'pendente' || canvasDeliveryStatus === 'atrasado';
}

export function countReadyToSubmit(
  items: Array<{ deliverableStatus?: string | null; canvasDeliveryStatus: string | null | undefined }>
): number {
  let count = 0;
  for (const item of items) {
    if (isReadyToSubmitInCanvas(item.deliverableStatus, item.canvasDeliveryStatus)) {
      count += 1;
    }
  }
  return count;
}

// ---- Classificação multi_part vs one_shot ----

const SEQUENCE_REGEX =
  /\b(parte|etapa|fase|sprint|marco|entrega\s+parcial|entrega|modulo|módulo|estagio|estágio|versao|versão|iteracao|iteração|passo|bloco)\s*(?:n[º°o.]?\s*)?(\d+|[ivx]{1,4})\b/i;

function romanToNumber(token: string): number | null {
  const map: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
  };
  return map[token.toLowerCase()] ?? null;
}

export interface ParsedSequenceInfo {
  matched: boolean;
  keyword: string | null;
  partNumber: number | null;
  stem: string;
}

export function parseAssignmentSequence(name: string): ParsedSequenceInfo {
  const raw = String(name || '').trim();
  const norm = normalizeText(raw);
  const m = norm.match(SEQUENCE_REGEX);
  if (!m) {
    return { matched: false, keyword: null, partNumber: null, stem: norm };
  }
  const keyword = m[1].replace(/\s+/g, ' ');
  const numToken = m[2];
  const partNumber = /^\d+$/.test(numToken) ? Number(numToken) : romanToNumber(numToken);
  const stem = norm
    .replace(SEQUENCE_REGEX, ' ')
    .replace(/[-–—:|()[\]/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    matched: partNumber !== null && partNumber > 0,
    keyword,
    partNumber,
    stem,
  };
}

function submissionTypesSignature(types?: string[]): string {
  if (!Array.isArray(types) || types.length === 0) return 'default';
  return [...types].map((t) => String(t).toLowerCase()).sort().join(',');
}

function buildSuggestedSchedule(dueAt: Date | null, prevDueAt: Date | null): {
  suggested_start_at: Date | null;
  suggested_review_at: Date | null;
} {
  if (!dueAt || Number.isNaN(dueAt.getTime())) {
    return { suggested_start_at: null, suggested_review_at: null };
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  const reviewAt = new Date(dueAt.getTime() - 1 * DAY_MS);
  let startAt = new Date(dueAt.getTime() - 5 * DAY_MS);
  if (prevDueAt && !Number.isNaN(prevDueAt.getTime()) && prevDueAt.getTime() > startAt.getTime()) {
    startAt = new Date(Math.min(prevDueAt.getTime() + DAY_MS, reviewAt.getTime()));
  }
  return { suggested_start_at: startAt, suggested_review_at: reviewAt };
}

function toSafeDate(val: Date | string | null | undefined): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function slugifyProjectKey(courseId: number, raw: string): string {
  const clean = normalizeText(raw)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `proj-${courseId}-${clean || 'sequencia'}`;
}

/**
 * Classifica os trabalhos de um curso em `multi_part` vs `one_shot`.
 * - Preserva overrides manuais (`assignment_kind_manual === true`).
 * - Aplica heurística: títulos sequenciais ("Parte 1", "Etapa 2", "Fase 3", "Entrega parcial")
 *   + `group_category_id` ou `submission_types` semelhantes + prazos escalonados (ou numeração sequencial).
 * - Trabalhos sem correspondência são `one_shot`.
 */
export function classifyAssignmentsForCourse(
  courseId: number,
  courseName: string,
  assignments: AssignmentRecord[],
  existingProjects: MultiPartProjectSpec[] = []
): AssignmentClassificationResult {
  const classifications: AssignmentClassificationResult['classifications'] = new Map();
  const projects: MultiPartProjectSpec[] = [];

  // 1. Separar overrides manuais que já pertencem a projetos manuais ou marcados como one_shot
  const manualOneShotIds = new Set<number>();
  const manualProjectGroups = new Map<string, AssignmentRecord[]>();

  for (const a of assignments) {
    if (a.assignment_kind_manual) {
      if (a.assignment_kind === 'one_shot') {
        manualOneShotIds.add(a.canvas_id);
        classifications.set(a.canvas_id, {
          assignment_kind: 'one_shot',
          project_id: null,
          part_order: null,
          depends_on: null,
        });
      } else if (a.assignment_kind === 'multi_part') {
        const pid = a.project_id || `proj-${courseId}-manual`;
        const list = manualProjectGroups.get(pid) || [];
        list.push(a);
        manualProjectGroups.set(pid, list);
      }
    }
  }

  // Reconstituir projetos manuais
  const existingProjectTitleMap = new Map(existingProjects.map((p) => [p.project_id, p.title]));
  for (const [pid, items] of manualProjectGroups.entries()) {
    const sorted = [...items].sort((x, y) => {
      const sx = parseAssignmentSequence(x.name).partNumber ?? 999;
      const sy = parseAssignmentSequence(y.name).partNumber ?? 999;
      if (sx !== sy) return sx - sy;
      const dx = toSafeDate(x.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const dy = toSafeDate(y.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return dx - dy;
    });

    const parts: ProjectPartSpec[] = sorted.map((item, idx) => {
      const prev = idx > 0 ? sorted[idx - 1] : null;
      const due = toSafeDate(item.due_at);
      const prevDue = prev ? toSafeDate(prev.due_at) : null;
      const { suggested_start_at, suggested_review_at } = buildSuggestedSchedule(due, prevDue);
      classifications.set(item.canvas_id, {
        assignment_kind: 'multi_part',
        project_id: pid,
        part_order: idx + 1,
        depends_on: prev ? prev.canvas_id : null,
      });
      return {
        assignment_id: item.canvas_id,
        name: item.name,
        order: idx + 1,
        depends_on: prev ? prev.canvas_id : null,
        due_at: due,
        suggested_start_at,
        suggested_review_at,
      };
    });

    projects.push({
      project_id: pid,
      course_id: courseId,
      course_name: courseName,
      title: existingProjectTitleMap.get(pid) || `Projeto ${courseName}`,
      manual: true,
      parts,
    });
  }

  // 2. Heurística para os demais trabalhos (não manuais)
  const candidates = assignments.filter(
    (a) => !manualOneShotIds.has(a.canvas_id) && !classifications.has(a.canvas_id)
  );

  // Agrupar candidatos com padrão sequencial por (group_category_id || stem + submissionTypes)
  const buckets = new Map<string, Array<{ assignment: AssignmentRecord; seq: ParsedSequenceInfo }>>();

  for (const a of candidates) {
    const seq = parseAssignmentSequence(a.name);
    const hasGroupCat = typeof a.group_category_id === 'number' && a.group_category_id > 0;
    if (!seq.matched && !hasGroupCat) {
      continue;
    }

    const subSig = submissionTypesSignature(a.submission_types);
    const bucketKey = hasGroupCat
      ? `gcat:${a.group_category_id}`
      : `stem:${seq.stem || seq.keyword || 'seq'}|sub:${subSig}`;

    const arr = buckets.get(bucketKey) || [];
    arr.push({ assignment: a, seq });
    buckets.set(bucketKey, arr);
  }

  for (const [bucketKey, entries] of buckets.entries()) {
    if (entries.length < 2) continue;

    // Verificar se há sequência numérica distinta ou prazos escalonados
    const seqMatchesCount = entries.filter((e) => e.seq.matched).length;
    const dueTimestamps = entries
      .map((e) => toSafeDate(e.assignment.due_at)?.getTime())
      .filter((t): t is number => typeof t === 'number');
    const uniqueDues = new Set(dueTimestamps).size;
    const hasEscalatedDues = dueTimestamps.length >= 2 && uniqueDues >= 2;
    const hasGroupCat = bucketKey.startsWith('gcat:');

    const isMultiPart =
      seqMatchesCount >= 2 || (hasGroupCat && (seqMatchesCount >= 1 || hasEscalatedDues));

    if (!isMultiPart) continue;

    const sorted = [...entries].sort((x, y) => {
      const nx = x.seq.partNumber ?? 999;
      const ny = y.seq.partNumber ?? 999;
      if (nx !== ny) return nx - ny;
      const dx = toSafeDate(x.assignment.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const dy = toSafeDate(y.assignment.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (dx !== dy) return dx - dy;
      return x.assignment.canvas_id - y.assignment.canvas_id;
    });

    const representativeStem =
      sorted.find((e) => e.seq.stem.length >= 3)?.seq.stem ||
      sorted[0].assignment.name.replace(SEQUENCE_REGEX, '').replace(/[-–—:|]+$/g, '').trim() ||
      courseName;

    const displayTitle =
      representativeStem.length >= 3
        ? representativeStem.charAt(0).toUpperCase() + representativeStem.slice(1)
        : `Projeto ${courseName}`;

    const projectId = slugifyProjectKey(courseId, representativeStem || bucketKey);

    const parts: ProjectPartSpec[] = sorted.map((entry, idx) => {
      const prev = idx > 0 ? sorted[idx - 1].assignment : null;
      const due = toSafeDate(entry.assignment.due_at);
      const prevDue = prev ? toSafeDate(prev.due_at) : null;
      const { suggested_start_at, suggested_review_at } = buildSuggestedSchedule(due, prevDue);

      classifications.set(entry.assignment.canvas_id, {
        assignment_kind: 'multi_part',
        project_id: projectId,
        part_order: idx + 1,
        depends_on: prev ? prev.canvas_id : null,
      });

      return {
        assignment_id: entry.assignment.canvas_id,
        name: entry.assignment.name,
        order: idx + 1,
        depends_on: prev ? prev.canvas_id : null,
        due_at: due,
        suggested_start_at,
        suggested_review_at,
      };
    });

    projects.push({
      project_id: projectId,
      course_id: courseId,
      course_name: courseName,
      title: displayTitle,
      manual: false,
      parts,
    });
  }

  // 3. Tudo que não foi classificado como multi_part vira one_shot
  for (const a of assignments) {
    if (!classifications.has(a.canvas_id)) {
      classifications.set(a.canvas_id, {
        assignment_kind: 'one_shot',
        project_id: null,
        part_order: null,
        depends_on: null,
      });
    }
  }

  return { classifications, projects };
}

// ---- Timeline e gate de dependência entre partes ----

export interface ComputePartTimelineInput {
  assignment: AssignmentRecord;
  dependsOnAssignment?: AssignmentRecord | null;
  deliverableStatus?: DeliverableStatus | null;
  now?: Date;
}

export function isAssignmentGraded(assignment: AssignmentRecord | null | undefined, now = new Date()): boolean {
  if (!assignment) return false;
  return classifyDeliveryStatus(assignment, now) === 'corrigido';
}

/**
 * Calcula o estado na linha do tempo de uma parte de projeto multi-parte.
 * Regra rígida: se `dependsOnAssignment` existe e ainda NÃO está corrigida,
 * a parte atual permanece `bloqueada` (não pode gerar entrega).
 */
export function computePartTimelineState(input: ComputePartTimelineInput): PartTimelineState {
  const now = input.now ?? new Date();
  const deliveryStatus = classifyDeliveryStatus(input.assignment, now);

  if (deliveryStatus === 'corrigido') return 'corrigida';
  if (deliveryStatus === 'entregue') {
    // Se já foi enviada no Canvas mas ainda não tem nota/correção
    return input.assignment.submitted_at ? 'aguardando_correcao' : 'enviada_por_mim';
  }

  // Gate rígido de dependência: não libera antes da correção da parte anterior no Canvas
  // ("Entrega gerada" no assistente NUNCA libera a parte seguinte!)
  if (input.dependsOnAssignment && !isAssignmentGraded(input.dependsOnAssignment, now)) {
    return 'bloqueada';
  }

  const normDeliv = input.deliverableStatus ? normalizeDeliverableStatus(input.deliverableStatus) : null;
  if (normDeliv === 'entrega_gerada') {
    return 'entrega_gerada';
  }
  if (normDeliv === 'rascunho' || normDeliv === 'revisada_por_mim' || normDeliv === 'validada') {
    return 'em_revisao';
  }

  return 'liberada';
}

export function canGenerateForPart(input: ComputePartTimelineInput): {
  allowed: boolean;
  state: PartTimelineState;
  reason?: string;
} {
  const state = computePartTimelineState(input);
  if (state === 'bloqueada') {
    const depName = input.dependsOnAssignment?.name || 'parte anterior';
    return {
      allowed: false,
      state,
      reason: `Bloqueada: aguarde a correção de "${depName}" no Canvas antes de gerar esta parte.`,
    };
  }
  return { allowed: true, state };
}

// ---- Detecção de correção no sync (para Web Push de multi-parte) ----

export interface GradedPartNotification {
  courseId: number;
  courseName: string;
  projectId: string;
  projectTitle: string;
  gradedAssignmentId: number;
  gradedAssignmentName: string;
  nextAssignmentId: number;
  nextAssignmentName: string;
  title: string;
  body: string;
}

/**
 * Detecta se um trabalho recém-corrigido no sync faz parte de um projeto multi-parte
 * e desbloqueia a próxima parte. Trabalhos `one_shot` retornam null (sem notificação de próxima parte).
 */
export function detectGradedPartUnlock(params: {
  prevDoc: Partial<AssignmentRecord> | null | undefined;
  nextDoc: AssignmentRecord;
  project: MultiPartProjectSpec | null | undefined;
  now?: Date;
}): GradedPartNotification | null {
  const { prevDoc, nextDoc, project } = params;
  const now = params.now ?? new Date();

  if (!project || nextDoc.assignment_kind !== 'multi_part') return null;

  const wasGraded = prevDoc ? isAssignmentGraded(prevDoc as AssignmentRecord, now) : false;
  const isNowGraded = isAssignmentGraded(nextDoc, now);
  if (wasGraded || !isNowGraded) return null;

  const nextPart = project.parts.find((p) => p.depends_on === nextDoc.canvas_id);
  if (!nextPart) return null;

  const scoreLabel =
    typeof nextDoc.score === 'number' && typeof nextDoc.points_possible === 'number'
      ? ` (${nextDoc.score}/${nextDoc.points_possible})`
      : nextDoc.grade
        ? ` (${nextDoc.grade})`
        : '';

  return {
    courseId: project.course_id,
    courseName: project.course_name,
    projectId: project.project_id,
    projectTitle: project.title,
    gradedAssignmentId: nextDoc.canvas_id,
    gradedAssignmentName: nextDoc.name,
    nextAssignmentId: nextPart.assignment_id,
    nextAssignmentName: nextPart.name,
    title: `${nextDoc.name} corrigida: gerar entrega da ${nextPart.name}?`,
    body: `${project.course_name}${scoreLabel} — feedback sincronizado. Abra o Assistente para gerar a próxima parte.`,
  };
}

// ---- Extração determinística de "Lições do professor" por curso ----

export function extractCourseLessonsFromAssignments(
  courseId: number,
  courseName: string,
  assignments: AssignmentRecord[],
  now = new Date()
): CourseLessonSummary {
  const chargedPoints: string[] = [];
  const recurringIssues: string[] = [];
  const strengths: string[] = [];
  const rawNotes: string[] = [];

  const issueKeywords = /\b(falt|erro|corrig|melhor|ausent|incomplet|atenc|atenç|precis|nao |não |sem |frac|revis|abnt|citac|citaç|referenc|referênc|justific)/i;
  const strengthKeywords = /\b(otim|ótim|excelent|parab|parabéns|bom|boa|muito bem|completo|bem estrutur|corret|atendeu)/i;

  for (const a of assignments) {
    if (!isAssignmentGraded(a, now)) continue;

    // 1. Comentários da submissão
    const comments = Array.isArray(a.submission_comments) ? a.submission_comments : [];
    for (const c of comments) {
      const txt = sanitizeHtmlToText(c.comment, 500);
      if (!txt || txt.length < 6) continue;
      const entry = `[${a.name}] ${c.author_name ? `${c.author_name}: ` : ''}${txt}`;
      rawNotes.push(entry);
      if (issueKeywords.test(txt)) {
        recurringIssues.push(entry);
      } else if (strengthKeywords.test(txt)) {
        strengths.push(entry);
      } else {
        chargedPoints.push(entry);
      }
    }

    // 2. Avaliação de rubrica
    const rubricMap = new Map<string, RubricCriterionData>();
    for (const crit of a.rubric || []) {
      if (crit.id) rubricMap.set(String(crit.id), crit);
    }
    if (a.rubric_assessment && typeof a.rubric_assessment === 'object') {
      for (const [critId, assess] of Object.entries(a.rubric_assessment)) {
        const crit = rubricMap.get(critId);
        const critLabel = crit?.description || `Critério ${critId}`;
        const maxPts = typeof crit?.points === 'number' ? crit.points : null;
        const pts = typeof assess?.points === 'number' ? assess.points : null;
        const comment = sanitizeHtmlToText(assess?.comments, 300);

        if (comment) {
          const line = `[${a.name} · ${critLabel}] ${comment}`;
          rawNotes.push(line);
          if (maxPts !== null && pts !== null && pts < maxPts) {
            recurringIssues.push(`${line} (${pts}/${maxPts} pts)`);
          } else if (maxPts !== null && pts !== null && pts >= maxPts) {
            strengths.push(`${line} (${pts}/${maxPts} pts)`);
          } else {
            chargedPoints.push(line);
          }
        } else if (maxPts !== null && pts !== null && pts < maxPts) {
          recurringIssues.push(`[${a.name}] Perda de nota em "${critLabel}" (${pts}/${maxPts} pts).`);
        } else if (maxPts !== null && pts !== null && pts >= maxPts && maxPts > 0) {
          strengths.push(`[${a.name}] Nota máxima em "${critLabel}" (${pts}/${maxPts} pts).`);
        }
      }
    }
  }

  const dedupe = (arr: string[], limit: number) => Array.from(new Set(arr)).slice(0, limit);

  return {
    course_id: courseId,
    course_name: courseName,
    charged_points: dedupe(chargedPoints, 12),
    recurring_issues: dedupe(recurringIssues, 15),
    strengths: dedupe(strengths, 10),
    raw_notes: dedupe(rawNotes, 25),
    updated_at: now,
  };
}

// ---- Montagem determinística do contexto para a IA ----

const CONTEXT_STOP_WORDS = new Set([
  'para', 'como', 'mais', 'pelo', 'pela', 'pelos', 'pelas', 'sobre', 'entre',
  'com', 'sem', 'uma', 'uns', 'umas', 'dos', 'das', 'que', 'nao', 'não',
  'trabalho', 'atividade', 'entrega', 'parte', 'etapa', 'fase', 'curso', 'aluno',
]);

function extractSearchKeywords(text: string): string[] {
  const norm = normalizeText(text);
  const tokens = norm
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !CONTEXT_STOP_WORDS.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([word]) => word);
}

function scoreTextRelevance(haystack: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const norm = normalizeText(haystack);
  let score = 0;
  for (const kw of keywords) {
    if (norm.includes(kw)) score += 1;
  }
  return score;
}

export function assignmentExpectsCode(assignment: AssignmentRecord): boolean {
  const combined = normalizeText(
    `${assignment.name || ''} ${sanitizeHtmlToText(assignment.description, 4000)} ${(assignment.rubric || [])
      .map((r) => `${r.description} ${r.long_description || ''}`)
      .join(' ')}`
  );
  return /\b(codigo|código|repositorio|repositório|github|git|python|java|javascript|typescript|c\+\+|csharp|c#|html|css|sql|algoritmo|programa|implementar|implementacao|implementação|api|endpoint|classe|funcoes|funções|script|readme)\b/i.test(
    combined
  );
}

// ---- Extração de anexos do HTML, Detecção de Formato, Questões, Divergência e Entendimento ----

export interface CanvasHtmlFileRef {
  fileId: number;
  label: string;
}

/**
 * Extrai referências a arquivos do Canvas (/courses/:cid/files/:id ou /files/:id)
 * embutidas no HTML do enunciado (assignment.description).
 */
export function extractCanvasFileRefsFromHtml(html: string | null | undefined): CanvasHtmlFileRef[] {
  if (!html) return [];
  const raw = String(html);
  const byId = new Map<number, string>();

  // 1. Tags <a> com href ou data-api-endpoint apontando para /files/:id
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(raw)) !== null) {
    const attrs = match[1] || '';
    const innerText = sanitizeHtmlToText(match[2], 200).trim();
    const idMatch =
      attrs.match(/(?:href|data-api-endpoint)\s*=\s*["'][^"']*\/files\/(\d+)/i) ||
      attrs.match(/data-id\s*=\s*["'](\d+)["']/i);
    if (idMatch) {
      const fid = Number(idMatch[1]);
      if (Number.isSafeInteger(fid) && fid > 0 && !byId.has(fid)) {
        const titleAttr = attrs.match(/title\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
        byId.set(fid, innerText || titleAttr || `arquivo-${fid}`);
      }
    }
  }

  // 2. Qualquer outra URL /files/:id (ex.: iframe, embed, link solto)
  const genericRegex = /\/files\/(\d+)(?:\/download|\?|["'\s<]|$)/gi;
  while ((match = genericRegex.exec(raw)) !== null) {
    const fid = Number(match[1]);
    if (Number.isSafeInteger(fid) && fid > 0 && !byId.has(fid)) {
      byId.set(fid, `arquivo-${fid}`);
    }
  }

  return Array.from(byId.entries()).map(([fileId, label]) => ({ fileId, label }));
}

const HANDWRITTEN_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'manuscrito', regex: /\bmanuscrit[oa]s?\b/i },
  { label: 'à mão', regex: /\ba\s+mao\b/i },
  { label: 'digitalize', regex: /\bdigitaliz(?:e|ar|ado|ada|acao)\b/i },
  { label: 'escanear', regex: /\b(?:escane(?:ar|ie|ado|ada)|scan(?:ear|ner)?)\b/i },
  { label: 'folha', regex: /\b(?:em\s+folha|na\s+folha|folha\s+(?:a4|de\s+papel|pautada|sulfite|separada|anexa)|copi(?:ar|e)\s+(?:em|na)\s+folha)\b/i },
  { label: 'caderno', regex: /\b(?:no\s+caderno|folha\s+de\s+caderno)\b/i },
  { label: 'copiar à mão', regex: /\bcopi(?:ar|e)\s+a\s+mao\b/i },
  { label: 'escrever à mão', regex: /\bescrev(?:er|a)\s+a\s+mao\b/i },
  { label: 'foto da folha', regex: /\b(?:foto\s+da\s+folha|fotograf(?:ar|e)\s+(?:a\s+folha|suas?\s+respostas?))\b/i },
];

export function detectHandwrittenFormat(text: string): {
  isHandwritten: boolean;
  matchedKeywords: string[];
} {
  const norm = normalizeText(String(text || ''));
  const matched: string[] = [];
  for (const p of HANDWRITTEN_PATTERNS) {
    if (p.regex.test(norm)) {
      matched.push(p.label);
    }
  }
  return {
    isHandwritten: matched.length > 0,
    matchedKeywords: matched,
  };
}

export function detectIsGroupAssignment(assignment: AssignmentRecord, combinedText: string): boolean {
  if (typeof assignment.group_category_id === 'number' && assignment.group_category_id > 0) {
    return true;
  }
  const norm = normalizeText(`${assignment.name || ''} ${combinedText}`);
  if (/\b(individual|trabalho individual|atividade individual|entrega individual)\b/i.test(norm)) {
    return false;
  }
  return /\b(em grupo|em equipe|em dupla|em trio|integrantes do grupo|membros do grupo|trabalho em grupo)\b/i.test(
    norm
  );
}

export function detectAssignmentFormat(
  assignment: AssignmentRecord,
  combinedText: string
): {
  format: AssignmentDeliveryFormat;
  isHandwritten: boolean;
  matchedKeywords: string[];
} {
  const hw = detectHandwrittenFormat(`${assignment.name || ''}\n${combinedText}`);
  if (hw.isHandwritten) {
    return { format: 'manuscrito', isHandwritten: true, matchedKeywords: hw.matchedKeywords };
  }

  const subTypes = (assignment.submission_types || []).map((s) => String(s).toLowerCase());
  if (assignmentExpectsCode(assignment)) {
    return { format: 'codigo', isHandwritten: false, matchedKeywords: [] };
  }
  if (subTypes.includes('online_url') && !subTypes.includes('online_upload') && !subTypes.includes('online_text_entry')) {
    return { format: 'link', isHandwritten: false, matchedKeywords: [] };
  }
  if (subTypes.includes('online_text_entry') && !subTypes.includes('online_upload')) {
    return { format: 'digitado', isHandwritten: false, matchedKeywords: [] };
  }
  if (subTypes.includes('online_upload')) {
    const norm = normalizeText(combinedText);
    if (/\b(redacao|redação|relatorio|relatório|artigo|resenha|dissertacao|dissertação|word|docx|pdf|lista|questoes|questões|perguntas|exercicio|exercício)\b/i.test(norm)) {
      return { format: 'digitado', isHandwritten: false, matchedKeywords: [] };
    }
    return { format: 'arquivo', isHandwritten: false, matchedKeywords: [] };
  }
  return { format: 'digitado', isHandwritten: false, matchedKeywords: [] };
}

/**
 * Extrai identificadores numéricos relevantes (ex.: "exercício 7", "lista 3", "prova 2", "parte 1")
 * para comparar título do trabalho no Canvas vs título/nome do anexo.
 */
function extractNumberedLabel(text: string): { kind: string; num: number } | null {
  const norm = normalizeText(text);
  const m = norm.match(
    /\b(exercicio|lista|atividade|trabalho|prova|avalia[cç]ao|avaliacao|parte|etapa|fase|modulo|estudo\s+dirigido|pratica|laboratorio|lab|capitulo|unidade)\s*(?:n[º°o.]?\s*|de\s+|da\s+|do\s+|prova\s+)?(\d{1,3})\b/i
  );
  if (!m) return null;
  return { kind: m[1].replace(/\s+/g, ' '), num: Number(m[2]) };
}

/**
 * Detecta divergência entre título/numeração do trabalho no Canvas e os anexos lidos.
 * Ex.: trabalho "Exercício 7" com anexo "Exercício 6.pdf" ou "Lista prova 3.pdf".
 */
export function detectTitleDivergence(
  assignmentName: string,
  attachments: Array<{ name: string; text?: string }>
): TitleDivergenceResult {
  if (!attachments || attachments.length === 0) {
    return { hasDivergence: false, reason: null, detectedAttachmentTitle: null };
  }

  const assignLabel = extractNumberedLabel(assignmentName);
  const assignTokens = new Set(
    normalizeText(assignmentName)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !CONTEXT_STOP_WORDS.has(t))
  );

  for (const att of attachments) {
    const cleanFileName = String(att.name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const firstLines = String(att.text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 4)
      .slice(0, 4)
      .join(' ');

    const attLabelFromName = extractNumberedLabel(cleanFileName);
    const attLabelFromText = extractNumberedLabel(firstLines);
    const attLabel = attLabelFromName || attLabelFromText;
    const detectedTitle = cleanFileName || firstLines.slice(0, 80) || null;

    // Caso 1: ambos têm numeração explícita (ex.: Exercício 7 vs Exercício 6, ou Exercício 7 vs Lista 3)
    if (assignLabel && attLabel) {
      if (assignLabel.num !== attLabel.num) {
        return {
          hasDivergence: true,
          reason: `O trabalho no Canvas se chama "${assignmentName}" (nº ${assignLabel.num}), mas o anexo "${att.name}" indica "${attLabel.kind} ${attLabel.num}". Confirme se o anexo pertence mesmo a este trabalho.`,
          detectedAttachmentTitle: detectedTitle,
        };
      }
    }

    // Caso 2: o nome do anexo parece ser claramente outro tipo/título numerado sem sobreposição com o nome do trabalho
    if (attLabelFromName && assignTokens.size >= 1) {
      const attTokens = normalizeText(cleanFileName)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !CONTEXT_STOP_WORDS.has(t));
      const overlap = attTokens.filter((t) => assignTokens.has(t));
      if (attTokens.length >= 2 && overlap.length === 0) {
        return {
          hasDivergence: true,
          reason: `O título do trabalho no Canvas ("${assignmentName}") diverge do nome do anexo ("${att.name}"). Confirme antes de gerar.`,
          detectedAttachmentTitle: detectedTitle,
        };
      }
    }
  }

  return { hasDivergence: false, reason: null, detectedAttachmentTitle: null };
}

/**
 * Detecta questões numeradas (fechadas, abertas e outras como palavras cruzadas/grades/figuras)
 * a partir do texto do enunciado e anexos.
 */
export function detectQuestionsFromText(text: string): DetectedQuestionsSummary {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  const norm = normalizeText(raw);

  const hasCrosswordOrGrid =
    /\b(palavra[s]?\s+cruzada[s]?|cruzadinha|caca[\s-]?palavras|grade\s+(?:de\s+palavras|abaixo|a\s+seguir)|horizontal\s*[:/]\s*vertical|horizontais\s+e\s+verticais)\b/i.test(
      norm
    );
  const hasFiguresOrTables =
    /\b(figura\s*\d*|diagrama|grafico|gr[aá]fico|tabela\s*\d*|imagem\s*\d*|observe\s+a\s+(?:figura|imagem|tabela|grade)|esquema\s+abaixo)\b/i.test(
      norm
    );

  // Localiza inícios de questões numeradas:
  // "1.", "1)", "01 -", "Questão 1", "Questao 1:", "Q1.", "Pergunta 1"
  const lines = raw.split('\n');
  const questionBlocks: Array<{ num: number; startLine: number; body: string }> = [];
  const seenNums = new Set<number>();

  const questionStartRegex =
    /^\s*(?:(?:quest[aã]o|pergunta|exerc[ií]cio|item|q)\s*(?:n[º°o.]?\s*)?(\d{1,3})\s*[:.)\-–—]?|(\d{1,3})\s*[.)\-–—]\s+(?=\S))/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(questionStartRegex);
    if (!m) continue;
    const num = Number(m[1] || m[2]);
    if (!Number.isFinite(num) || num <= 0 || num > 200) continue;

    // Ignorar números soltos que parecem datas (ex.: "2026 - ...") ou anos ou listas de subitens fora de ordem absurda
    if (num > 100 && !seenNums.has(num - 1)) continue;
    // Se já vimos esse número, só ignora duplicatas (ex.: enumeração de cruzadinha)
    if (seenNums.has(num)) continue;

    seenNums.add(num);
    questionBlocks.push({ num, startLine: i, body: line });
  }

  // Anexar corpo de cada questão até a próxima questão
  for (let idx = 0; idx < questionBlocks.length; idx++) {
    const start = questionBlocks[idx].startLine;
    const end = idx + 1 < questionBlocks.length ? questionBlocks[idx + 1].startLine : lines.length;
    questionBlocks[idx].body = lines.slice(start, end).join('\n');
  }

  let closed = 0;
  let open = 0;
  let other = 0;

  for (const qb of questionBlocks) {
    const body = qb.body;
    const bodyNorm = normalizeText(body);

    // Detecta se é palavra cruzada / grade
    if (/\b(palavra[s]?\s+cruzada|cruzadinha|grade|preencha\s+o\s+quadro|complete\s+a\s+tabela)\b/i.test(bodyNorm)) {
      other += 1;
      continue;
    }

    // Detecta alternativas de múltipla escolha: pelo menos 2 alternativas a) b) c) d) ou (a) (b) ou A. B.
    const altMatches = body.match(/(?:^|\n|\s)(?:\(?[a-eA-E]\)|[a-eA-E]\.\s+\S|\([a-eA-E]\)\s+\S)/g) || [];
    const distinctAlts = new Set(
      altMatches
        .map((s) => s.match(/[a-eA-E]/)?.[0]?.toLowerCase())
        .filter((x): x is string => Boolean(x))
    );

    if (distinctAlts.size >= 3 || (distinctAlts.size >= 2 && /\b(assinale|marque|alternativa|correta|incorreta|verdadeiro|falso|v\s*ou\s*f)\b/i.test(bodyNorm))) {
      closed += 1;
    } else {
      open += 1;
    }
  }

  // Se há palavra cruzada no texto mas não foi contada como questão numerada, adiciona 1 em other
  if (hasCrosswordOrGrid && other === 0) {
    other += 1;
  }

  const questionNumbers = questionBlocks.map((q) => q.num).sort((a, b) => a - b);

  return {
    total: questionNumbers.length + (hasCrosswordOrGrid && !questionBlocks.some((q) => /\b(cruzada|cruzadinha|grade)\b/i.test(normalizeText(q.body))) ? 1 : 0),
    closed,
    open,
    other,
    questionNumbers,
    hasCrosswordOrGrid,
    hasFiguresOrTables,
  };
}

/**
 * Checagem de completude por questão: compara o conjunto de questões numeradas detectadas
 * no enunciado/anexo com as questões efetivamente respondidas no markdown gerado.
 */
export function checkAnswerCompleteness(
  expectedQuestionNumbers: number[],
  generatedMarkdown: string
): CompletenessCheckResult {
  const uniqueExpected = Array.from(new Set(expectedQuestionNumbers.filter((n) => Number.isFinite(n) && n > 0))).sort(
    (a, b) => a - b
  );
  if (uniqueExpected.length === 0) {
    return {
      expectedCount: 0,
      answeredCount: 0,
      expectedNumbers: [],
      answeredNumbers: [],
      missingNumbers: [],
      passed: true,
    };
  }

  const text = String(generatedMarkdown || '');
  const answeredNumbers: number[] = [];
  const missingNumbers: number[] = [];

  for (const num of uniqueExpected) {
    // Aceita padrões:
    // "1 - b", "1) ...", "1. ...", "**1.**", "### Questão 2", "Q1 -", "01 - b", "3 (horizontal, 3 letras): TCP"
    const padded = num < 10 ? `0?${num}` : `${num}`;
    const pattern = new RegExp(
      `(?:^|\\n)\\s*(?:(?:#{1,6}\\s*)?(?:\\*\\*)?(?:quest[aã]o|pergunta|exerc[ií]cio|q)\\s*${padded}(?:\\*\\*)?(?:\\s*[-–—.)\\]:(]|\\s*(?=\\n|$))|(?:#{1,6}\\s*)?(?:\\*\\*)?${padded}(?:\\*\\*)?\\s*(?:[-–—.)\\]:(]|\\s+-\\s+))`,
      'i'
    );
    if (pattern.test(text)) {
      answeredNumbers.push(num);
    } else {
      missingNumbers.push(num);
    }
  }

  return {
    expectedCount: uniqueExpected.length,
    answeredCount: answeredNumbers.length,
    expectedNumbers: uniqueExpected,
    answeredNumbers,
    missingNumbers,
    passed: missingNumbers.length === 0,
  };
}

/**
 * Decide se um PDF precisa de leitura multimodal (visão com Gemini):
 * - texto extraído curto demais para o nº de páginas (< 120 chars/página)
 * - presença de palavras cruzadas, grades, tabelas, figuras ou diagramas
 */
export function shouldUseVisionForPdf(params: {
  pages: number;
  extractedChars: number;
  text: string;
}): { needsVision: boolean; reason: string | null } {
  const pages = Math.max(1, params.pages || 1);
  const charsPerPage = params.extractedChars / pages;
  const norm = normalizeText(params.text || '');

  if (params.extractedChars === 0) {
    return { needsVision: true, reason: 'PDF sem texto extraível (provavelmente escaneado ou baseado em imagens).' };
  }
  if (charsPerPage < 120) {
    return {
      needsVision: true,
      reason: `Pouco texto extraído (${params.extractedChars} chars em ${pages} pág. — ${Math.round(charsPerPage)} chars/pág.).`,
    };
  }
  if (/\b(palavra[s]?\s+cruzada[s]?|cruzadinha|caca[\s-]?palavras|grade\s+abaixo|horizontais\s+e\s+verticais)\b/i.test(norm)) {
    return { needsVision: true, reason: 'PDF contém palavra cruzada ou grade visual.' };
  }
  if (/\b(figura\s*\d*|diagrama|grafico|gr[aá]fico|tabela\s*\d*|observe\s+a\s+(?:figura|imagem|tabela|grade)|esquema)\b/i.test(norm)) {
    return { needsVision: true, reason: 'PDF referencia figuras, diagramas ou tabelas.' };
  }
  return { needsVision: false, reason: null };
}

/**
 * Valida e corrige o markdown gerado antes de salvar:
 * - Corrige cabeçalhos malformados (ex.: "## ## Checklist" -> "## Checklist")
 * - Remove "## Checklist da rubrica" quando o trabalho NÃO tem rubrica
 * - Normaliza espaçamento excessivo
 */
export interface MarkdownValidationResult {
  markdown: string;
  fixedHeadings: number;
  removedEmptyRubric: boolean;
  warnings: string[];
}

export function validateAndSanitizeGeneratedMarkdown(
  rawMarkdown: string,
  options: { hasRubric: boolean; isGroup: boolean }
): MarkdownValidationResult {
  let text = String(rawMarkdown || '').replace(/\r\n/g, '\n');
  let fixedHeadings = 0;
  let removedEmptyRubric = false;
  const warnings: string[] = [];

  // 1. Corrigir cabeçalhos duplicados/malformados como "## ## Checklist", "### ## Titulo", "# # Capa"
  text = text.replace(/^(#{1,6})\s+(?:#{1,6}\s+)+(.+)$/gm, (_m, firstHashes: string, title: string) => {
    fixedHeadings += 1;
    return `${firstHashes} ${title.trim()}`;
  });

  // Corrigir cabeçalhos sem espaço após # (ex.: "##Titulo" -> "## Titulo"), ignorando tags/hex
  text = text.replace(/^(#{1,6})([A-Za-zÀ-ÖØ-öø-ÿ0-9])/gm, (_m, hashes: string, ch: string) => {
    fixedHeadings += 1;
    return `${hashes} ${ch}`;
  });

  // 2. Remover seção "Checklist da rubrica" quando o trabalho não tem rubrica
  if (!options.hasRubric) {
    const before = text;
    text = text.replace(
      /\n*#{1,4}\s*Checklist\s+da\s+rubrica[\s\S]*?(?=\n#{1,2}\s+[^\n]+|$)/gi,
      ''
    );
    if (text !== before) {
      removedEmptyRubric = true;
    }
  }

  // 3. Limpar quebras excessivas
  text = text.replace(/\n{4,}/g, '\n\n\n').trim();

  if (fixedHeadings > 0) {
    warnings.push(`${fixedHeadings} cabeçalho(s) Markdown malformado(s) corrigido(s) automaticamente.`);
  }
  if (removedEmptyRubric) {
    warnings.push('Seção "Checklist da rubrica" removida pois o trabalho não possui rubrica no Canvas.');
  }

  return {
    markdown: text,
    fixedHeadings,
    removedEmptyRubric,
    warnings,
  };
}

export interface BuildUnderstandingInput {
  courseId: number;
  courseName: string;
  assignment: AssignmentRecord;
  attachments: ExtractedAttachmentText[];
  manualStatement?: string | null;
  myProject?: string | null;
  previousSubmissionsCount?: number;
  coursePagesCount?: number;
  hasTeacherLessons?: boolean;
}

/**
 * Monta o cartão estruturado "O que entendi" (Etapa 1 obrigatória antes de gerar).
 * Nunca preenche o enunciado a partir de entregas antigas nem de memória.
 */
export function buildUnderstandingSummary(input: BuildUnderstandingInput): UnderstandingSummary {
  const descriptionText = sanitizeHtmlToText(input.assignment.description, 9_000);
  const manualText = String(input.manualStatement || '').trim();
  const readableAtts = input.attachments.filter((a) => a.status !== 'error' && a.status !== 'empty' && a.status !== 'too_large' && a.text.trim().length > 0);
  const combinedStatementText = [
    descriptionText,
    manualText,
    ...readableAtts.map((a) => a.text),
  ]
    .filter(Boolean)
    .join('\n\n');

  const formatInfo = detectAssignmentFormat(input.assignment, combinedStatementText);
  const isGroup = detectIsGroupAssignment(input.assignment, combinedStatementText);
  const questions = detectQuestionsFromText(combinedStatementText);
  const titleDivergence = detectTitleDivergence(
    input.assignment.name,
    input.attachments.map((a) => ({ name: a.name, text: a.text }))
  );

  const attachmentItems: UnderstandingAttachmentItem[] = input.attachments.map((a) => {
    const pages = Math.max(1, a.pages || 1);
    const charsExtracted = typeof a.charsExtracted === 'number' ? a.charsExtracted : a.text.trim().length;
    const isPdf = a.contentType.toLowerCase().includes('pdf') || a.name.toLowerCase().endsWith('.pdf');
    const visionCheck = isPdf
      ? shouldUseVisionForPdf({ pages, extractedChars: charsExtracted, text: a.text })
      : { needsVision: false, reason: null };

    const status: UnderstandingAttachmentItem['status'] =
      a.status || (charsExtracted === 0 ? 'empty' : 'ok');

    return {
      fileId: a.fileId,
      name: a.name,
      contentType: a.contentType,
      pages,
      charsExtracted,
      status,
      needsVision: Boolean(a.needsVision ?? visionCheck.needsVision),
      visionReason: a.visionReason ?? visionCheck.reason,
      error: a.error,
    };
  });

  const hasAttachments = attachmentItems.length > 0;
  const allAttachmentsUnreadable =
    hasAttachments &&
    attachmentItems.every((a) => a.status === 'error' || a.status === 'empty' || a.status === 'too_large');
  const anyAttachmentUnreadable =
    hasAttachments &&
    attachmentItems.some((a) => a.status === 'error' || a.status === 'empty' || a.status === 'too_large');

  // Se o anexo não pôde ser lido (falha, vazio, escaneado sem texto) e o aluno não colou o enunciado manualmente,
  // e o texto do Canvas sozinho é curto/insuficiente (< 150 chars), BLOQUEIA a geração!
  const needsVision = attachmentItems.some((a) => a.needsVision);
  const unreadableAttachments =
    !manualText &&
    ((allAttachmentsUnreadable && descriptionText.length < 200) ||
      (anyAttachmentUnreadable && descriptionText.length < 80));

  const hasNoStatementAtAll =
    !manualText && descriptionText.length < 25 && readableAtts.length === 0;

  let canProceed = true;
  let blockReason: string | null = null;

  if (unreadableAttachments) {
    canProceed = false;
    blockReason =
      'Não foi possível extrair texto do(s) anexo(s) do trabalho (arquivo vazio, escaneado sem texto ou falha de leitura). Cole o enunciado manualmente abaixo para continuar com segurança.';
  } else if (hasNoStatementAtAll) {
    canProceed = false;
    blockReason =
      'O enunciado no Canvas está vazio e não há anexo legível. Cole o enunciado manualmente abaixo — o assistente não vai inventar nem copiar de trabalhos antigos.';
  }

  const sourcesPreview: GenerationSourceRef[] = [];
  if (descriptionText) {
    sourcesPreview.push({
      kind: 'enunciado',
      label: `Enunciado Canvas (${input.assignment.name})`,
      detail: `${descriptionText.length} caracteres`,
    });
  }
  if (manualText) {
    sourcesPreview.push({
      kind: 'enunciado_manual',
      label: 'Enunciado colado manualmente',
      detail: `${manualText.length} caracteres`,
    });
  }
  for (const att of attachmentItems) {
    sourcesPreview.push({
      kind: att.needsVision ? 'visao_pdf' : 'anexo',
      label: att.name,
      detail: `${att.pages} pág. · ${att.charsExtracted} chars${att.needsVision ? ' · Visão Gemini' : ''}`,
    });
  }
  if (input.myProject && input.myProject.trim()) {
    sourcesPreview.push({
      kind: 'meu_projeto',
      label: 'Meu projeto (curso)',
      detail: `${input.myProject.trim().length} caracteres`,
    });
  }
  if ((input.previousSubmissionsCount || 0) > 0) {
    sourcesPreview.push({
      kind: 'entrega_anterior',
      label: `${input.previousSubmissionsCount} entrega(s) anterior(es) (apenas referência de projeto/continuidade)`,
    });
  }
  if ((input.coursePagesCount || 0) > 0) {
    sourcesPreview.push({
      kind: 'pagina_curso',
      label: `${input.coursePagesCount} página(s) do curso`,
    });
  }
  if (input.hasTeacherLessons) {
    sourcesPreview.push({
      kind: 'licoes_professor',
      label: 'Feedbacks / Lições do professor neste curso',
    });
  }

  return {
    assignmentId: input.assignment.canvas_id,
    assignmentName: input.assignment.name,
    courseId: input.courseId,
    courseName: input.courseName,
    submissionTypes: Array.isArray(input.assignment.submission_types) ? input.assignment.submission_types : [],
    detectedFormat: formatInfo.format,
    isHandwritten: formatInfo.isHandwritten,
    handwrittenKeywords: formatInfo.matchedKeywords,
    isGroup,
    dueAt: input.assignment.due_at ? new Date(input.assignment.due_at).toISOString() : null,
    pointsPossible: typeof input.assignment.points_possible === 'number' ? input.assignment.points_possible : null,
    hasRubric: Array.isArray(input.assignment.rubric) && input.assignment.rubric.length > 0,
    attachments: attachmentItems,
    questions,
    titleDivergence,
    unreadableAttachments,
    needsVision,
    canProceed,
    blockReason,
    sourcesPreview,
  };
}

/**
 * Formata o texto do "Modo copiar à mão" em .txt limpo e legível para copiar numa folha.
 */
export function formatHandwrittenCopyTxt(
  markdown: string,
  meta?: { assignmentName?: string; courseName?: string }
): string {
  const header: string[] = [];
  if (meta?.courseName) header.push(`DISCIPLINA: ${meta.courseName}`);
  if (meta?.assignmentName) header.push(`TRABALHO: ${meta.assignmentName}`);
  if (header.length > 0) {
    header.push('MODO: COPIAR A MAO');
    header.push('='.repeat(60));
    header.push('');
  }

  const cleaned = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+(.+)$/gm, (_m, title: string) => `\n${title.trim().toUpperCase()}\n${'-'.repeat(Math.min(50, title.trim().length))}`)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `${header.join('\n')}${cleaned}\n`;
}

/**
 * Monta o contexto completo e seguro (anti prompt-injection) com ISOLAMENTO ESTRITO
 * do trabalho atual. Entregas anteriores entram SOMENTE como referência claramente rotulada.
 */
export function buildDeliverableContext(input: BuildContextInput): BuiltDeliverableContext {
  const maxChars = input.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const descriptionText = sanitizeHtmlToText(input.assignment.description, 9_000);
  const manualStatement = String(input.manualStatement || '').trim().slice(0, 14_000);
  const rubricLines = (input.assignment.rubric || []).map(
    (r, idx) =>
      `${idx + 1}. ${r.description} (${r.points} pts)${r.long_description ? ` — ${sanitizeHtmlToText(r.long_description, 400)}` : ''}`
  );
  const hasRubric = rubricLines.length > 0;

  const validAttachments = (input.assignmentAttachments || []).filter((a) => a.text && a.text.trim().length > 0);
  const combinedCurrentStatement = [
    descriptionText,
    manualStatement,
    ...validAttachments.map((a) => a.text),
  ]
    .filter(Boolean)
    .join('\n\n');

  const formatInfo = detectAssignmentFormat(input.assignment, combinedCurrentStatement);
  const isHandwritten = typeof input.isHandwritten === 'boolean' ? input.isHandwritten : formatInfo.isHandwritten;
  const isGroup =
    typeof input.isGroup === 'boolean'
      ? input.isGroup
      : detectIsGroupAssignment(input.assignment, combinedCurrentStatement);
  const detectedQuestions = input.detectedQuestions ?? detectQuestionsFromText(combinedCurrentStatement);

  const keywords = extractSearchKeywords(
    `${input.assignment.name} ${combinedCurrentStatement.slice(0, 4000)} ${rubricLines.join(' ')}`
  );

  const sections: string[] = [];
  const usedSources: GenerationSourceRef[] = [];

  // 1. Metadados do trabalho ATUAL (com ID explícito para isolamento)
  const metaLines = [
    `ID Canvas do Trabalho Atual: ${input.assignment.canvas_id}`,
    `Disciplina: ${input.courseName}`,
    `Título do Trabalho Atual: ${input.assignment.name}`,
    `Tipo detectado: ${input.assignment.assignment_kind === 'multi_part' ? 'Projeto multi-parte' : 'Entrega única (one-shot)'}`,
    `Formato da entrega: ${isHandwritten ? 'MANUSCRITO (copiar à mão e digitalizar)' : formatInfo.format}`,
    `Modalidade: ${isGroup ? 'Em grupo' : 'Individual'}`,
    `Prazo: ${formatSaoPauloDateTime(input.assignment.due_at)}`,
    `Pontos possíveis: ${input.assignment.points_possible ?? 'Não informado'}`,
    `Tipos de submissão aceitos: ${(input.assignment.submission_types || []).join(', ') || 'Não informado'}`,
    `Possui rubrica no Canvas: ${hasRubric ? 'Sim' : 'Não'}`,
  ];
  if (detectedQuestions.questionNumbers.length > 0) {
    metaLines.push(
      `Questões numeradas detectadas: ${detectedQuestions.questionNumbers.length} (números: ${detectedQuestions.questionNumbers.join(', ')} | fechadas: ${detectedQuestions.closed}, abertas: ${detectedQuestions.open}, outras/grades: ${detectedQuestions.other})`
    );
  }
  if (input.studentName) metaLines.push(`Aluno: ${input.studentName}`);
  // Regra estrita: incluir integrantes SOMENTE se o trabalho for em grupo!
  if (isGroup && input.groupMembers && input.groupMembers.length > 0) {
    metaLines.push(`Integrantes do grupo: ${input.groupMembers.join(', ')}`);
  }
  sections.push(wrapUntrustedData('METADADOS_TRABALHO_ATUAL', metaLines.join('\n')));

  // 2. Enunciado do trabalho ATUAL e rubrica (fonte primária e soberana)
  const enunciadoHeader = `[TRABALHO ATUAL #${input.assignment.canvas_id}: ${input.assignment.name}]\n`;
  if (descriptionText) {
    usedSources.push({
      kind: 'enunciado',
      label: `Enunciado Canvas (${input.assignment.name})`,
      detail: `${descriptionText.length} chars`,
    });
  }
  sections.push(
    wrapUntrustedData(
      'ENUNCIADO',
      `${enunciadoHeader}${descriptionText || 'Sem descrição cadastrada no Canvas.'}`
    )
  );

  if (manualStatement) {
    usedSources.push({
      kind: 'enunciado_manual',
      label: 'Enunciado colado manualmente pelo aluno',
      detail: `${manualStatement.length} chars`,
    });
    sections.push(
      wrapUntrustedData(
        'ENUNCIADO_COLADO_PELO_ALUNO',
        `${enunciadoHeader}${manualStatement}`
      )
    );
  }

  if (hasRubric) {
    sections.push(wrapUntrustedData('RUBRICA', rubricLines.join('\n')));
  }

  // 3. Anexos DO TRABALHO ATUAL (limite generoso para listas com muitas questões)
  if (validAttachments.length > 0) {
    const attBlocks = validAttachments.slice(0, 4).map((att) => {
      const snippet = att.text.slice(0, 14_000);
      usedSources.push({
        kind: att.needsVision ? 'visao_pdf' : 'anexo',
        label: att.name,
        detail: `${att.pages || 1} pág. · ${att.text.length} chars${att.needsVision ? ' · Visão' : ''}`,
      });
      return `Arquivo do trabalho atual (#${input.assignment.canvas_id}): ${att.name} (${att.contentType}${att.pages ? `, ${att.pages} pág.` : ''})\n${snippet}`;
    });
    sections.push(wrapUntrustedData('ANEXOS_DO_TRABALHO', attBlocks.join('\n\n---\n\n')));
  }

  if ((input.visionPagesUsed || 0) > 0) {
    usedSources.push({
      kind: 'visao_pdf',
      label: `Leitura visual (Gemini Vision)`,
      detail: `${input.visionPagesUsed} página(s) renderizada(s)`,
    });
  }

  // 4. "Meu projeto" do curso (para perguntas do tipo "considerando o seu projeto")
  if (input.myProject && input.myProject.trim()) {
    const projText = input.myProject.trim().slice(0, 5_000);
    usedSources.push({
      kind: 'meu_projeto',
      label: 'Campo "Meu projeto" do curso',
      detail: `${projText.length} chars`,
    });
    sections.push(
      wrapUntrustedData(
        'MEU_PROJETO_DO_CURSO',
        `Descrição oficial do projeto do aluno neste curso (use SOMENTE quando a questão perguntar sobre o projeto do aluno):\n${projText}`
      )
    );
  }

  // 5. Parte anterior aprovada (se projeto multi-parte)
  if (input.previousPartApproved) {
    const prev = input.previousPartApproved;
    const prevComments = (prev.comments || [])
      .map((c) => `${c.author_name || 'Professor'}: ${sanitizeHtmlToText(c.comment, 500)}`)
      .filter(Boolean);
    const prevLines = [
      `Parte anterior aprovada (APENAS referência de continuidade): ${prev.name}`,
      `Nota: ${prev.score ?? prev.grade ?? 'Não informada'}${prev.points_possible ? ` / ${prev.points_possible}` : ''}`,
      prevComments.length > 0 ? `Feedback do professor:\n${prevComments.join('\n')}` : '',
      prev.approved_markdown
        ? `Texto aprovado da parte anterior:\n${prev.approved_markdown.slice(0, 6_000)}`
        : '',
    ].filter(Boolean);
    usedSources.push({
      kind: 'entrega_anterior',
      label: `Parte anterior aprovada: ${prev.name}`,
    });
    sections.push(wrapUntrustedData('PARTE_ANTERIOR_APROVADA', prevLines.join('\n\n')));
  }

  // 6. Lições do professor do curso
  if (input.teacherLessons) {
    const l = input.teacherLessons;
    const lessonLines: string[] = [];
    if (l.recurring_issues.length > 0) {
      lessonLines.push(`Erros recorrentes / pontos descontados:\n- ${l.recurring_issues.slice(0, 8).join('\n- ')}`);
    }
    if (l.charged_points.length > 0) {
      lessonLines.push(`O que o professor costuma cobrar:\n- ${l.charged_points.slice(0, 8).join('\n- ')}`);
    }
    if (l.strengths.length > 0) {
      lessonLines.push(`O que rendeu nota alta:\n- ${l.strengths.slice(0, 6).join('\n- ')}`);
    }
    if (lessonLines.length > 0) {
      usedSources.push({
        kind: 'licoes_professor',
        label: 'Feedback / Lições do professor',
        detail: `${l.recurring_issues.length} alerta(s)`,
      });
      sections.push(wrapUntrustedData('LICOES_DO_PROFESSOR', lessonLines.join('\n\n')));
    }
  }

  // 7. Materiais relevantes do curso (top N páginas e arquivos ranqueados por relevância)
  const rankedPages = (input.coursePages || [])
    .map((p) => {
      const cleanBody = sanitizeHtmlToText(p.body, 2_500);
      const score = scoreTextRelevance(`${p.title} ${cleanBody}`, keywords);
      return { title: p.title, body: cleanBody, score };
    })
    .filter((p) => p.body.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const rankedFiles = (input.courseFiles || [])
    .map((f) => {
      const score = scoreTextRelevance(`${f.display_name} ${f.origin_path || ''} ${f.extracted_text || ''}`, keywords);
      return { ...f, score };
    })
    .filter((f) => f.score > 0 || Boolean(f.extracted_text))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const materialChunks: string[] = [];
  for (const p of rankedPages) {
    materialChunks.push(`[Página] ${p.title}\n${p.body.slice(0, 1_800)}`);
    usedSources.push({ kind: 'pagina_curso', label: p.title });
  }
  for (const f of rankedFiles) {
    materialChunks.push(
      `[Arquivo] ${f.display_name} (${f.origin_path || 'Raiz'})${f.extracted_text ? `\n${f.extracted_text.slice(0, 1_800)}` : ''}`
    );
    usedSources.push({ kind: 'arquivo_curso', label: f.display_name, detail: f.origin_path || 'Raiz' });
  }
  if (materialChunks.length > 0) {
    sections.push(wrapUntrustedData('MATERIAIS_RELEVANTES_DO_CURSO', materialChunks.join('\n\n---\n\n')));
  }

  // 8. Entregas anteriores do usuário no curso (ISOLAMENTO: somente referência de continuidade/projeto, nunca enunciado!)
  // Filtra estritamente para nunca incluir o próprio trabalho atual nem enunciados alheios como tarefa.
  const prevSubs = (input.previousSubmissions || [])
    .filter((s) => s.assignment_id !== input.assignment.canvas_id)
    .slice(0, 3);
  if (prevSubs.length > 0) {
    const subBlocks = prevSubs.map((s) => {
      const dateStr = s.submitted_at ? formatSaoPauloDateTime(s.submitted_at) : 'data não informada';
      usedSources.push({
        kind: 'entrega_anterior',
        label: s.name,
        detail: dateStr,
      });
      const parts: string[] = [
        `[REFERÊNCIA DE ENTREGA ANTERIOR — NÃO É O ENUNCIADO ATUAL] Trabalho: "${s.name}" | Data: ${dateStr} | Nota: ${s.score ?? s.grade ?? '—'}${s.points_possible ? `/${s.points_possible}` : ''}`,
      ];
      if (s.submitted_text) {
        parts.push(`Trecho entregue pelo aluno:\n${sanitizeHtmlToText(s.submitted_text, 1_800)}`);
      }
      if (s.attachments_text && s.attachments_text.length > 0) {
        for (const att of s.attachments_text.slice(0, 2)) {
          parts.push(`Anexo enviado pelo aluno (${att.name}):\n${att.text.slice(0, 1_800)}`);
        }
      }
      if (s.comments && s.comments.length > 0) {
        const cmts = s.comments
          .map((c) => `${c.author_name || 'Professor'}: ${sanitizeHtmlToText(c.comment, 300)}`)
          .filter(Boolean);
        if (cmts.length > 0) parts.push(`Comentários:\n${cmts.join('\n')}`);
      }
      return parts.join('\n');
    });
    sections.push(
      wrapUntrustedData(
        'ENTREGAS_ANTERIORES_DO_ALUNO_APENAS_REFERENCIA',
        `AVISO: Os textos abaixo são de OUTROS trabalhos já entregues anteriormente. Use APENAS como referência de continuidade ou quando o enunciado atual perguntar "considerando o seu projeto" (citando nome e data). NUNCA substitua nem altere o enunciado do trabalho atual (#${input.assignment.canvas_id}: ${input.assignment.name}).\n\n${subBlocks.join('\n\n---\n\n')}`
      )
    );
  }

  // Truncamento global respeitando maxChars
  let combined = sections.join('\n\n');
  if (combined.length > maxChars) {
    combined = `${combined.slice(0, maxChars)}\n\n[... contexto adicional truncado pelo limite de segurança ...]`;
  }

  return {
    assignmentId: input.assignment.canvas_id,
    assignmentName: input.assignment.name,
    promptDataBlock: combined,
    totalChars: combined.length,
    preferLongContextModel: combined.length >= LONG_CONTEXT_THRESHOLD_CHARS,
    includedMaterialsCount: materialChunks.length,
    includedPreviousCount: prevSubs.length,
    expectsCode: assignmentExpectsCode(input.assignment),
    hasRubric,
    isHandwritten,
    isGroup,
    detectedQuestions,
    usedSources,
  };
}

/**
 * Extrai blocos de código marcados com `### Arquivo: caminho/arquivo.ext` (ou `**Arquivo: ...**`)
 * para gerar um `.zip` organizado em entregas com código.
 */
export function extractCodeFilesFromMarkdown(markdown: string): ExtractedCodeFile[] {
  const files: ExtractedCodeFile[] = [];
  const regex =
    /(?:^|\n)(?:#{2,4}\s*(?:Arquivo|File)\s*:\s*`?([^\n`]+)`?|\*\*(?:Arquivo|File)\s*:\s*`?([^\n`*]+)`?\*\*)\s*\n+```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const rawPath = (match[1] || match[2] || '').trim();
    const language = (match[3] || 'txt').trim();
    const content = match[4] ?? '';
    const safePath = rawPath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    if (safePath) {
      files.push({ path: safePath, language, content });
    }
  }
  return files;
}
