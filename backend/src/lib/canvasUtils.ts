export type DeliveryStatus =
  | 'corrigido'
  | 'entregue'
  | 'pendente'
  | 'atrasado'
  | 'dispensado'
  | 'sem_entrega_online';

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  corrigido: 'Corrigido',
  entregue: 'Entregue',
  pendente: 'Pendente',
  atrasado: 'Atrasado',
  dispensado: 'Dispensado',
  sem_entrega_online: 'Sem entrega online',
};

export interface AssignmentStatusInput {
  due_at?: Date | string | null;
  lock_at?: Date | string | null;
  locked_for_user?: boolean | null;
  points_possible?: number | null;
  submission_types?: string[] | null;
  workflow_state?: string | null;
  submitted_at?: Date | string | null;
  score?: number | null;
  grade?: string | null;
  late?: boolean | null;
  missing?: boolean | null;
  excused?: boolean | null;
}

const NON_ONLINE_SUBMISSION_TYPES = new Set(['none', 'on_paper', 'not_graded']);

/**
 * Classifica o status de entrega de um trabalho do Canvas.
 */
export function classifyDeliveryStatus(
  input: AssignmentStatusInput,
  now = new Date()
): DeliveryStatus {
  if (input.excused) return 'dispensado';

  const types = Array.isArray(input.submission_types) ? input.submission_types : [];
  const hasOnlyNonOnline =
    types.length > 0 && types.every((t) => NON_ONLINE_SUBMISSION_TYPES.has(String(t)));

  const wf = String(input.workflow_state || '').toLowerCase();
  const hasScoreOrGrade =
    (typeof input.score === 'number' && Number.isFinite(input.score)) ||
    (typeof input.grade === 'string' && input.grade.trim().length > 0);
  const hasSubmission = Boolean(input.submitted_at) || wf === 'submitted' || wf === 'pending_review';

  if (wf === 'graded' || (hasScoreOrGrade && wf !== 'unsubmitted')) {
    return 'corrigido';
  }
  if (hasSubmission) {
    return 'entregue';
  }
  if (hasOnlyNonOnline) {
    return 'sem_entrega_online';
  }

  const due = input.due_at ? new Date(input.due_at) : null;
  const dueValid = due && !Number.isNaN(due.getTime()) ? due : null;

  // Atividades travadas sem prazo (ex.: quizzes/avaliações bloqueadas sem data) não são entregas pendentes
  if (input.locked_for_user && !dueValid) {
    return 'sem_entrega_online';
  }

  if (input.missing || (dueValid && dueValid.getTime() < now.getTime())) {
    return 'atrasado';
  }

  return 'pendente';
}

export function normalizeText(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const STOP_WORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'para',
  'com',
  'por',
  'a',
  'o',
  'as',
  'os',
  'no',
  'na',
  'nos',
  'nas',
  'um',
  'uma',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'turma',
  'manha',
  'tarde',
  'noite',
  'puc',
  'minas',
]);

const IGNORED_UPPERCASE_TOKENS = new Set(['PUC', 'PLU', 'EAD', 'ICEI', 'NOITE', 'MANHA', 'TARDE']);

/**
 * Gera apelidos automáticos (sigla das iniciais do nome da disciplina)
 * Ex.: "Interação Humano-Computador - Engenharia de Software - Campus Lourdes - PLU - Noite - 2026/2" -> ["IHC"]
 *      "Desenvolvimento e Integração de Aplicações Web - ..." -> ["DIAW"]
 *      "Trabalho Interdisciplinar: Desenvolvimento Centrado no Usuário - ..." -> ["TI", "TIDCU"]
 */
export function generateAutoAliases(courseName: string, courseCode = ''): string[] {
  const aliases = new Set<string>();
  // Remove sufixo institucional da PUC (" - Engenharia de Software - Campus Lourdes - PLU - ...")
  const mainTitle = String(courseName || '').split(/\s+-\s+/)[0] || String(courseName || '');

  const extractAcronym = (segment: string): string | null => {
    const cleaned = segment
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/^\d+[\s._-]+/, '')
      .replace(/[-_/]+/g, ' ');
    const words = cleaned
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, ''))
      .filter((w) => w.length > 0 && !/^\d+$/.test(w));
    const significant = words.filter((w) => !STOP_WORDS.has(normalizeText(w)));
    if (significant.length >= 2) {
      const acr = significant.map((w) => normalizeText(w)[0]).join('').toUpperCase();
      if (acr.length >= 2 && acr.length <= 6) return acr;
    }
    return null;
  };

  const fullAcr = extractAcronym(mainTitle);
  if (fullAcr) aliases.add(fullAcr);

  // Se houver ":" (ex.: "Trabalho Interdisciplinar: Desenvolvimento Centrado no Usuário"), gera sigla também antes dos ":"
  if (mainTitle.includes(':')) {
    const beforeColon = extractAcronym(mainTitle.split(':')[0]);
    if (beforeColon) aliases.add(beforeColon);
  }

  // Também inclui siglas já presentes em maiúsculas no título principal ou código
  const rawTokens = `${mainTitle} ${courseCode}`.match(/\b[A-Z]{2,6}\b/g) || [];
  for (const token of rawTokens) {
    if (!STOP_WORDS.has(token.toLowerCase()) && !IGNORED_UPPERCASE_TOKENS.has(token)) {
      aliases.add(token);
    }
  }

  return Array.from(aliases);
}

export interface CourseLike {
  canvas_id: number;
  name: string;
  course_code?: string;
  aliases?: string[];
  auto_aliases?: string[];
}

/**
 * Resolve uma referência textual de curso (nome parcial, apelido manual ou sigla automática).
 * Retorna todos os cursos compatíveis (permite detectar ambiguidades/duplicados).
 */
export function resolveCoursesByQuery<T extends CourseLike>(courses: T[], query: string): T[] {
  const q = normalizeText(query);
  if (!q) return courses;

  // 1. Match exato por alias manual ou automático
  const exactAlias = courses.filter((c) => {
    const allAliases = [
      ...(Array.isArray(c.aliases) ? c.aliases : []),
      ...(Array.isArray(c.auto_aliases) ? c.auto_aliases : generateAutoAliases(c.name, c.course_code)),
    ];
    return allAliases.some((a) => normalizeText(a) === q);
  });
  if (exactAlias.length > 0) return exactAlias;

  // 2. Match por substring no nome, código ou aliases
  const partial = courses.filter((c) => {
    const haystacks = [
      c.name,
      c.course_code || '',
      ...(Array.isArray(c.aliases) ? c.aliases : []),
      ...(Array.isArray(c.auto_aliases) ? c.auto_aliases : []),
    ].map(normalizeText);
    return haystacks.some((h) => h.includes(q));
  });
  if (partial.length > 0) return partial;

  // 3. Match por todas as palavras da consulta
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length > 1) {
    return courses.filter((c) => {
      const nameNorm = normalizeText(c.name);
      return tokens.every((t) => nameNorm.includes(t));
    });
  }

  return [];
}

export function formatSaoPauloDateTime(date: Date | string | null | undefined): string {
  if (!date) return 'Sem data';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function saoPauloDayBounds(now = new Date()): {
  todayStart: Date;
  todayEnd: Date;
  weekEnd: Date;
} {
  const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(now);
  const todayStart = new Date(`${todayStr}T00:00:00.000-03:00`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const weekEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { todayStart, todayEnd, weekEnd };
}
