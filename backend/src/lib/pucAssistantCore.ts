import { classifyDeliveryStatus, formatSaoPauloDateTime, normalizeText } from './canvasUtils';

export type AssignmentKind = 'multi_part' | 'one_shot';

export type DeliverableStatus = 'entrega_gerada' | 'revisada_por_mim' | 'pronta';

export type PartTimelineState =
  | 'bloqueada'
  | 'liberada'
  | 'entrega_gerada'
  | 'em_revisao'
  | 'enviada_por_mim'
  | 'aguardando_correcao'
  | 'corrigida';

export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  entrega_gerada: 'Entrega gerada',
  revisada_por_mim: 'Em revisão',
  pronta: 'Pronta para exportar',
};

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
  name: string;
  contentType: string;
  text: string;
  truncated?: boolean;
}

export interface PreviousSubmissionInput {
  assignment_id: number;
  name: string;
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
  coursePages?: ContextPageInput[];
  courseFiles?: ContextFileInput[];
  previousSubmissions?: PreviousSubmissionInput[];
  previousPartApproved?: PreviousPartApprovedInput | null;
  teacherLessons?: CourseLessonSummary | null;
  groupMembers?: string[];
  studentName?: string | null;
  maxContextChars?: number;
}

export interface BuiltDeliverableContext {
  promptDataBlock: string;
  totalChars: number;
  preferLongContextModel: boolean;
  includedMaterialsCount: number;
  includedPreviousCount: number;
  expectsCode: boolean;
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
 * Regra rígida de exportação: só libera PDF/download final quando status === 'pronta'
 * e não existir nenhum marcador `[PREENCHER: ...]` pendente.
 */
export function canExportDeliverable(
  status: DeliverableStatus | string | null | undefined,
  markdown: string
): ExportGateResult {
  const pendingPlaceholders = findPendingPlaceholders(markdown);
  const reasons: string[] = [];

  if (status !== 'pronta') {
    reasons.push('A entrega precisa ser revisada e marcada como "Pronta para exportar" antes de gerar o PDF.');
  }
  if (pendingPlaceholders.length > 0) {
    reasons.push(
      `Existem ${pendingPlaceholders.length} marcador(es) [PREENCHER] pendente(s) que precisam ser completados antes de exportar.`
    );
  }
  if (!String(markdown || '').trim()) {
    reasons.push('O conteúdo da entrega está vazio.');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    pendingPlaceholders,
  };
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

  // Gate rígido de dependência: não libera antes da correção da parte anterior
  if (input.dependsOnAssignment && !isAssignmentGraded(input.dependsOnAssignment, now)) {
    return 'bloqueada';
  }

  if (input.deliverableStatus === 'revisada_por_mim' || input.deliverableStatus === 'pronta') {
    return 'em_revisao';
  }
  if (input.deliverableStatus === 'entrega_gerada') {
    return 'entrega_gerada';
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

/**
 * Monta o contexto completo e seguro (anti prompt-injection) para gerar uma entrega pronta.
 * Seleciona apenas os materiais mais relevantes (top N) sem despejar o curso inteiro.
 */
export function buildDeliverableContext(input: BuildContextInput): BuiltDeliverableContext {
  const maxChars = input.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const descriptionText = sanitizeHtmlToText(input.assignment.description, 9_000);
  const rubricLines = (input.assignment.rubric || []).map(
    (r, idx) =>
      `${idx + 1}. ${r.description} (${r.points} pts)${r.long_description ? ` — ${sanitizeHtmlToText(r.long_description, 400)}` : ''}`
  );
  const keywords = extractSearchKeywords(`${input.assignment.name} ${descriptionText} ${rubricLines.join(' ')}`);

  const sections: string[] = [];

  // 1. Metadados do trabalho
  const metaLines = [
    `Disciplina: ${input.courseName}`,
    `Trabalho: ${input.assignment.name}`,
    `Tipo detectado: ${input.assignment.assignment_kind === 'multi_part' ? 'Projeto multi-parte' : 'Entrega única (one-shot)'}`,
    `Prazo: ${formatSaoPauloDateTime(input.assignment.due_at)}`,
    `Pontos possíveis: ${input.assignment.points_possible ?? 'Não informado'}`,
    `Tipos de submissão aceitos: ${(input.assignment.submission_types || []).join(', ') || 'Não informado'}`,
  ];
  if (input.studentName) metaLines.push(`Aluno: ${input.studentName}`);
  if (input.groupMembers && input.groupMembers.length > 0) {
    metaLines.push(`Integrantes do grupo: ${input.groupMembers.join(', ')}`);
  }
  sections.push(wrapUntrustedData('METADADOS_TRABALHO', metaLines.join('\n')));

  // 2. Enunciado e rubrica
  sections.push(wrapUntrustedData('ENUNCIADO', descriptionText || 'Sem descrição cadastrada no Canvas.'));
  if (rubricLines.length > 0) {
    sections.push(wrapUntrustedData('RUBRICA', rubricLines.join('\n')));
  }

  // 3. Anexos do enunciado / trabalho
  if (input.assignmentAttachments && input.assignmentAttachments.length > 0) {
    const attBlocks = input.assignmentAttachments.slice(0, 4).map((att) => {
      const snippet = att.text.slice(0, 4_000);
      return `Arquivo: ${att.name} (${att.contentType})\n${snippet}`;
    });
    sections.push(wrapUntrustedData('ANEXOS_DO_TRABALHO', attBlocks.join('\n\n---\n\n')));
  }

  // 4. Parte anterior aprovada (se projeto multi-parte)
  if (input.previousPartApproved) {
    const prev = input.previousPartApproved;
    const prevComments = (prev.comments || [])
      .map((c) => `${c.author_name || 'Professor'}: ${sanitizeHtmlToText(c.comment, 500)}`)
      .filter(Boolean);
    const prevLines = [
      `Parte anterior: ${prev.name}`,
      `Nota: ${prev.score ?? prev.grade ?? 'Não informada'}${prev.points_possible ? ` / ${prev.points_possible}` : ''}`,
      prevComments.length > 0 ? `Feedback do professor:\n${prevComments.join('\n')}` : '',
      prev.approved_markdown
        ? `Texto aprovado da parte anterior:\n${prev.approved_markdown.slice(0, 8_000)}`
        : '',
    ].filter(Boolean);
    sections.push(wrapUntrustedData('PARTE_ANTERIOR_APROVADA', prevLines.join('\n\n')));
  }

  // 5. Lições do professor do curso
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
      sections.push(wrapUntrustedData('LICOES_DO_PROFESSOR', lessonLines.join('\n\n')));
    }
  }

  // 6. Materiais relevantes do curso (top N páginas e arquivos ranqueados por relevância)
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
  }
  for (const f of rankedFiles) {
    materialChunks.push(
      `[Arquivo] ${f.display_name} (${f.origin_path || 'Raiz'})${f.extracted_text ? `\n${f.extracted_text.slice(0, 1_800)}` : ''}`
    );
  }
  if (materialChunks.length > 0) {
    sections.push(wrapUntrustedData('MATERIAIS_RELEVANTES_DO_CURSO', materialChunks.join('\n\n---\n\n')));
  }

  // 7. Entregas anteriores do usuário no curso (para continuidade, nível e vocabulário)
  const prevSubs = (input.previousSubmissions || []).slice(0, 3);
  if (prevSubs.length > 0) {
    const subBlocks = prevSubs.map((s) => {
      const parts: string[] = [
        `Trabalho anterior: ${s.name} | Nota: ${s.score ?? s.grade ?? '—'}${s.points_possible ? `/${s.points_possible}` : ''}`,
      ];
      if (s.submitted_text) {
        parts.push(`Trecho entregue:\n${sanitizeHtmlToText(s.submitted_text, 2_000)}`);
      }
      if (s.attachments_text && s.attachments_text.length > 0) {
        for (const att of s.attachments_text.slice(0, 2)) {
          parts.push(`Anexo enviado (${att.name}):\n${att.text.slice(0, 2_000)}`);
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
    sections.push(wrapUntrustedData('ENTREGAS_ANTERIORES_DO_ALUNO', subBlocks.join('\n\n---\n\n')));
  }

  // Truncamento global respeitando maxChars
  let combined = sections.join('\n\n');
  if (combined.length > maxChars) {
    combined = `${combined.slice(0, maxChars)}\n\n[... contexto adicional truncado pelo limite de segurança ...]`;
  }

  return {
    promptDataBlock: combined,
    totalChars: combined.length,
    preferLongContextModel: combined.length >= LONG_CONTEXT_THRESHOLD_CHARS,
    includedMaterialsCount: materialChunks.length,
    includedPreviousCount: prevSubs.length,
    expectsCode: assignmentExpectsCode(input.assignment),
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
