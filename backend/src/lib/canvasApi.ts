const DEFAULT_CANVAS_BASE_URL = 'https://pucminas.instructure.com';
const MAX_RETRIES = 4;
const DEFAULT_TIMEOUT_MS = 25_000;

export class CanvasApiError extends Error {
  status: number;
  endpoint: string;

  constructor(status: number, endpoint: string, message?: string) {
    super(message || `Canvas API HTTP ${status} em ${endpoint}`);
    this.name = 'CanvasApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

export function getCanvasBaseUrl(): string {
  const raw = (process.env.CANVAS_BASE_URL || DEFAULT_CANVAS_BASE_URL).trim();
  return raw.replace(/\/+$/, '');
}

/**
 * Extrai a URL `rel="next"` do header RFC 5988 `Link` do Canvas.
 */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/i);
    if (match && match[2].toLowerCase() === 'next') {
      return match[1];
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = getCanvasBaseUrl();
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${normalizedPath}`;
}

function ensurePerPage(urlStr: string, perPage = 100): string {
  const u = new URL(urlStr);
  if (!u.searchParams.has('per_page')) {
    u.searchParams.set('per_page', String(perPage));
  }
  return u.toString();
}

export interface CanvasRequestOptions {
  onUnauthorized?: () => void | Promise<void>;
  timeoutMs?: number;
}

async function canvasFetchResponse(
  pathOrUrl: string,
  token: string,
  opts: CanvasRequestOptions = {}
): Promise<Response> {
  const url = buildUrl(pathOrUrl);
  const safeEndpoint = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return pathOrUrl;
    }
  })();

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (res.status === 401) {
        if (opts.onUnauthorized) await opts.onUnauthorized();
        throw new CanvasApiError(401, safeEndpoint, 'Token do Canvas expirado ou inválido (401).');
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfterRaw = res.headers.get('retry-after');
        const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
        const waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, 30_000)
            : Math.min(1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 400), 20_000);
        attempt += 1;
        await sleep(waitMs);
        continue;
      }

      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 2) {
        attempt += 1;
        await sleep(1000 * attempt);
        continue;
      }

      if (!res.ok) {
        throw new CanvasApiError(res.status, safeEndpoint);
      }

      return res;
    } catch (err) {
      if (err instanceof CanvasApiError) throw err;
      if (attempt < 2) {
        attempt += 1;
        await sleep(800 * attempt);
        continue;
      }
      throw new CanvasApiError(0, safeEndpoint, err instanceof Error ? err.message : 'Erro de rede no Canvas');
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function canvasGetOne<T>(
  pathOrUrl: string,
  token: string,
  opts: CanvasRequestOptions = {}
): Promise<T> {
  const res = await canvasFetchResponse(pathOrUrl, token, opts);
  return (await res.json()) as T;
}

export async function canvasGetAll<T>(
  path: string,
  token: string,
  opts: CanvasRequestOptions = {}
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = ensurePerPage(buildUrl(path), 100);
  let pageGuard = 0;

  while (nextUrl && pageGuard < 200) {
    pageGuard += 1;
    const res = await canvasFetchResponse(nextUrl, token, opts);
    const data = (await res.json()) as unknown;
    if (Array.isArray(data)) {
      items.push(...(data as T[]));
    } else if (data && typeof data === 'object') {
      // Alguns endpoints encapsulam em objeto; ignora se inesperado
      break;
    }
    nextUrl = parseNextLink(res.headers.get('link'));
  }

  return items;
}

// ---- Tipos da API REST do Canvas ----

export interface CanvasUserSelf {
  id: number;
  name: string;
  short_name?: string;
  sortable_name?: string;
  login_id?: string;
}

export interface CanvasTerm {
  id: number;
  name: string;
  start_at?: string | null;
  end_at?: string | null;
}

export interface CanvasEnrollmentApi {
  type?: string;
  role?: string;
  enrollment_state?: string;
  computed_current_score?: number | null;
  computed_final_score?: number | null;
  computed_current_grade?: string | null;
  computed_final_grade?: string | null;
}

export interface CanvasCourseApi {
  id: number;
  name?: string;
  course_code?: string;
  workflow_state?: string;
  enrollment_term_id?: number;
  term?: CanvasTerm;
  enrollments?: CanvasEnrollmentApi[];
  access_restricted_by_date?: boolean;
}

export interface CanvasSubmissionAttachmentApi {
  id?: number;
  display_name?: string;
  filename?: string;
  size?: number;
  url?: string;
  'content-type'?: string;
}

export interface CanvasSubmissionCommentApi {
  id?: number;
  author_name?: string | null;
  comment?: string | null;
  created_at?: string | null;
}

export interface CanvasRubricAssessmentEntryApi {
  points?: number | null;
  comments?: string | null;
  rating_id?: string | null;
}

export interface CanvasSubmissionApi {
  id?: number;
  workflow_state?: string | null;
  submitted_at?: string | null;
  body?: string | null;
  score?: number | null;
  grade?: string | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
  attachments?: CanvasSubmissionAttachmentApi[];
  submission_comments?: CanvasSubmissionCommentApi[];
  rubric_assessment?: Record<string, CanvasRubricAssessmentEntryApi> | null;
}

export interface CanvasRubricCriterionApi {
  id?: string;
  description?: string;
  long_description?: string;
  points?: number;
}

export interface CanvasAssignmentApi {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  lock_at?: string | null;
  locked_for_user?: boolean;
  points_possible?: number | null;
  html_url?: string | null;
  submission_types?: string[];
  group_category_id?: number | null;
  quiz_id?: number | null;
  is_quiz_assignment?: boolean;
  external_tool_tag_attributes?: { url?: string | null; new_tab?: boolean } | null;
  created_at?: string | null;
  position?: number | null;
  updated_at?: string | null;
  published?: boolean;
  submission?: CanvasSubmissionApi | null;
  rubric?: CanvasRubricCriterionApi[] | null;
}

export interface CanvasGroupApi {
  id: number;
  name?: string;
  course_id?: number;
  group_category_id?: number | null;
  members_count?: number;
}

export interface CanvasGroupUserApi {
  id: number;
  name?: string;
  short_name?: string;
  sortable_name?: string;
}

export interface CanvasAnnouncementApi {
  id: number;
  title: string;
  message?: string | null;
  posted_at?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  author?: { display_name?: string | null } | null;
}

export interface CanvasPageApi {
  page_id?: number;
  url: string;
  title: string;
  body?: string | null;
  html_url?: string | null;
  updated_at?: string | null;
  published?: boolean;
}

export interface CanvasFolderApi {
  id: number;
  name: string;
  full_name?: string;
  parent_folder_id?: number | null;
  files_count?: number;
}

export interface CanvasFileApi {
  id: number;
  folder_id?: number | null;
  display_name?: string;
  filename?: string;
  size?: number;
  'content-type'?: string;
  content_type?: string;
  updated_at?: string | null;
  url?: string; // URL assinada (NUNCA persistir no Mongo!)
  html_url?: string | null;
}

export interface CanvasModuleItemApi {
  id: number;
  title: string;
  type: string;
  position?: number;
  content_id?: number;
  page_url?: string;
  external_url?: string;
  html_url?: string;
}

export interface CanvasModuleApi {
  id: number;
  name: string;
  position?: number;
  items?: CanvasModuleItemApi[];
}

// ---- Chamadas de alto nível ----

export function validateCanvasToken(token: string): Promise<CanvasUserSelf> {
  return canvasGetOne<CanvasUserSelf>('/api/v1/users/self', token);
}

export function listActiveCourses(
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasCourseApi[]> {
  return canvasGetAll<CanvasCourseApi>(
    '/api/v1/courses?enrollment_state=active&include[]=term&include[]=total_scores&per_page=100',
    token,
    opts
  );
}

export function listCourseAssignments(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasAssignmentApi[]> {
  return canvasGetAll<CanvasAssignmentApi>(
    `/api/v1/courses/${courseId}/assignments?include[]=submission&include[]=submission_comments&include[]=rubric_assessment&per_page=100`,
    token,
    opts
  );
}

export function listCourseOwnGroups(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasGroupApi[]> {
  return canvasGetAll<CanvasGroupApi>(
    `/api/v1/courses/${courseId}/groups?only_own_groups=true&per_page=100`,
    token,
    opts
  );
}

export function listGroupUsers(
  groupId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasGroupUserApi[]> {
  return canvasGetAll<CanvasGroupUserApi>(
    `/api/v1/groups/${groupId}/users?per_page=100`,
    token,
    opts
  );
}

export function listCourseAnnouncements(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasAnnouncementApi[]> {
  return canvasGetAll<CanvasAnnouncementApi>(
    `/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=100`,
    token,
    opts
  );
}

export function listCoursePages(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasPageApi[]> {
  return canvasGetAll<CanvasPageApi>(
    `/api/v1/courses/${courseId}/pages?per_page=100`,
    token,
    opts
  );
}

export function getCoursePage(
  courseId: number,
  slug: string,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasPageApi> {
  return canvasGetOne<CanvasPageApi>(
    `/api/v1/courses/${courseId}/pages/${encodeURIComponent(slug)}`,
    token,
    opts
  );
}

export function listCourseFiles(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasFileApi[]> {
  return canvasGetAll<CanvasFileApi>(
    `/api/v1/courses/${courseId}/files?per_page=100`,
    token,
    opts
  );
}

export function listCourseFolders(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasFolderApi[]> {
  return canvasGetAll<CanvasFolderApi>(
    `/api/v1/courses/${courseId}/folders?per_page=100`,
    token,
    opts
  );
}

export function listFolderFiles(
  folderId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasFileApi[]> {
  return canvasGetAll<CanvasFileApi>(
    `/api/v1/folders/${folderId}/files?per_page=100`,
    token,
    opts
  );
}

export function listCourseModules(
  courseId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasModuleApi[]> {
  return canvasGetAll<CanvasModuleApi>(
    `/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`,
    token,
    opts
  );
}

export function getCanvasFileMeta(
  fileId: number,
  token: string,
  opts?: CanvasRequestOptions
): Promise<CanvasFileApi> {
  return canvasGetOne<CanvasFileApi>(`/api/v1/files/${fileId}`, token, opts);
}

