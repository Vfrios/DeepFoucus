import crypto from 'crypto';
import type { Db } from 'mongodb';
import { sendPushToAll, sendPushToUser } from '../routes/push';
import { EncryptedPayload, encryptCanvasToken, decryptCanvasToken, computeDaysRemaining } from './canvasAuth';
import { normalizeText } from './canvasUtils';
import { ExtractedCodeFile } from './pucAssistantCore';

const CONFIG_DOC_ID = 'puc_github' as const;
const WARN_DAYS_THRESHOLD = 7;
const TIME_ZONE = 'America/Sao_Paulo';
export const MAX_GITHUB_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_SHA_CONFLICT_RETRIES = 3;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_API_BASE = 'https://api.github.com';

export type FetchLike = typeof fetch;

export interface GithubConfigDoc extends EncryptedPayload {
  _id: typeof CONFIG_DOC_ID;
  owner: string;
  repo: string;
  branch: string;
  auto_publish: boolean;
  saved_at: Date;
  expires_at: Date | null;
  auth_error?: 401 | 403 | null;
  last_auth_error_at?: Date | null;
  last_push_date?: string | null;
  last_push_reason?: 'expiring' | 'auth_error' | null;
}

export interface GithubConfigStatus {
  configured: boolean;
  decryptError?: boolean;
  owner: string;
  repo: string;
  branch: string;
  autoPublish: boolean;
  savedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  expiringSoon: boolean;
  expired: boolean;
  authError: 401 | 403 | null;
}

export interface GithubConnectionTestResult {
  ok: true;
  owner: string;
  repo: string;
  branch: string;
  isPrivate: true;
  defaultBranch: string;
  htmlUrl: string;
  permissions: { push: boolean; admin: boolean };
}

export interface GithubFileToCommit {
  path: string;
  content: Buffer;
}

export interface GithubPublishResult {
  commitSha: string;
  htmlUrl: string;
  folderUrl: string;
  branch: string;
  paths: string[];
  deletedPaths?: string[];
  retriesUsed: number;
}

export interface DeliverableGithubPaths {
  folderPath: string;
  pdfPath: string | null;
  txtPath: string | null;
  mdPath: string;
  zipPath: string | null;
  codeFilePaths: Array<{ path: string; content: string }>;
  commitMessage: string;
}

export class GithubApiError extends Error {
  status: number;
  endpoint: string;

  constructor(status: number, endpoint: string, message?: string) {
    super(message || `GitHub API HTTP ${status} em ${endpoint}`);
    this.name = 'GithubApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

// Reutiliza exatamente o padrão AES-256-GCM com ENCRYPTION_KEY do Canvas
export function encryptGithubToken(plainToken: string): EncryptedPayload {
  return encryptCanvasToken(plainToken);
}

export function decryptGithubToken(payload: EncryptedPayload): string {
  return decryptCanvasToken(payload);
}

export function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function getApiBaseUrl(): string {
  return (process.env.GITHUB_API_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
}

function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(now);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Sanitização de caminhos/nomes para GitHub ----

/**
 * Sanitiza um segmento de pasta ou arquivo para o repositório GitHub:
 * - Remove acentos, `..`, `/`, `\`, caracteres de controle e caracteres inválidos.
 * - Preserva extensão quando `preserveExtension = true`.
 */
export function sanitizeGithubSegment(
  raw: string,
  fallback = 'item',
  preserveExtension = false,
  maxLen = 80
): string {
  const str = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|#%?]+/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .trim();

  let ext = '';
  let stem = str;
  if (preserveExtension) {
    const dot = str.lastIndexOf('.');
    if (dot > 0 && str.length - dot <= 12) {
      ext = str
        .slice(dot)
        .replace(/[^a-zA-Z0-9.]/g, '')
        .toLowerCase();
      stem = str.slice(0, dot);
    }
  }

  const cleanStem = stem
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, Math.max(1, maxLen - ext.length));

  const result = `${cleanStem || fallback}${ext}`;
  return result === '.' || result === '..' ? fallback : result;
}

/**
 * Sanitiza um caminho relativo interno (ex.: `src/utils/helper.ts`), bloqueando `..` e barras absolutas.
 */
export function sanitizeGithubRelativePath(rawPath: string, fallbackFile = 'arquivo.txt'): string {
  const parts = String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  if (parts.length === 0) return fallbackFile;
  return parts
    .map((seg, idx) => sanitizeGithubSegment(seg, idx === parts.length - 1 ? fallbackFile : 'dir', idx === parts.length - 1, 60))
    .join('/');
}

/**
 * Monta a estrutura padronizada no repositório privado:
 * `<semestre>/<sigla-do-curso>/<nome-do-trabalho-sanitizado>/entrega-v<N>.md`,
 * `entrega-v<N>.pdf` (quando digitada) ou `copiar-a-mao-v<N>.txt` (quando manuscrita)
 * e, se houver código, `codigo-v<N>/...` e `codigo-v<N>.zip`.
 */
export function buildDeliverableGithubPaths(params: {
  semester: string;
  courseAcronym: string;
  assignmentName: string;
  version: number;
  isHandwritten?: boolean;
  codeFiles?: ExtractedCodeFile[];
}): DeliverableGithubPaths {
  const semSeg = sanitizeGithubSegment(params.semester || 'sem-semestre', 'sem-semestre', false, 32);
  const acronymRaw = (params.courseAcronym || 'PUC').trim().toUpperCase();
  const acronymSeg = sanitizeGithubSegment(acronymRaw, 'PUC', false, 20).toUpperCase();
  const workSeg = sanitizeGithubSegment(params.assignmentName || 'trabalho', 'trabalho', false, 80);
  const ver = Math.max(1, Math.floor(params.version || 1));

  const folderPath = `${semSeg}/${acronymSeg}/${workSeg}`;
  const isHandwritten = Boolean(params.isHandwritten);
  const pdfPath = isHandwritten ? null : `${folderPath}/entrega-v${ver}.pdf`;
  const txtPath = isHandwritten ? `${folderPath}/copiar-a-mao-v${ver}.txt` : null;
  const mdPath = `${folderPath}/entrega-v${ver}.md`;

  const codeFiles = Array.isArray(params.codeFiles) ? params.codeFiles : [];
  const usedCodePaths = new Set<string>();
  const codeFilePaths: Array<{ path: string; content: string }> = [];

  for (const f of codeFiles) {
    const rel = sanitizeGithubRelativePath(f.path, 'arquivo.txt');
    const full = `${folderPath}/codigo-v${ver}/${rel}`;
    const key = full.toLowerCase();
    if (usedCodePaths.has(key)) continue;
    usedCodePaths.add(key);
    codeFilePaths.push({ path: full, content: f.content });
  }

  const zipPath = codeFilePaths.length > 0 ? `${folderPath}/codigo-v${ver}.zip` : null;
  const cleanTitle = String(params.assignmentName || 'Trabalho')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 120);
  const commitMessage = `[${acronymSeg}] ${cleanTitle} - v${ver} (validada)`;

  return {
    folderPath,
    pdfPath,
    txtPath,
    mdPath,
    zipPath,
    codeFilePaths,
    commitMessage,
  };
}

/**
 * Monta a estrutura para entregas geradas automaticamente pelo Agente em `pendentes/`:
 * `pendentes/<semestre>/<sigla>/<trabalho>/entrega-v1.md`,
 * `entrega-v1.pdf` (digitada) ou `copiar-a-mao-v1.txt` (manuscrita), e código quando houver.
 */
export function buildPendingDeliverableGithubPaths(params: {
  semester: string;
  courseAcronym: string;
  assignmentName: string;
  version?: number;
  isHandwritten?: boolean;
  codeFiles?: ExtractedCodeFile[];
}): DeliverableGithubPaths {
  const semSeg = sanitizeGithubSegment(params.semester || 'sem-semestre', 'sem-semestre', false, 32);
  const acronymRaw = (params.courseAcronym || 'PUC').trim().toUpperCase();
  const acronymSeg = sanitizeGithubSegment(acronymRaw, 'PUC', false, 20).toUpperCase();
  const workSeg = sanitizeGithubSegment(params.assignmentName || 'trabalho', 'trabalho', false, 80);
  const ver = Math.max(1, Math.floor(params.version || 1));

  const folderPath = `pendentes/${semSeg}/${acronymSeg}/${workSeg}`;
  const isHandwritten = Boolean(params.isHandwritten);
  const pdfPath = isHandwritten ? null : `${folderPath}/entrega-v${ver}.pdf`;
  const txtPath = isHandwritten ? `${folderPath}/copiar-a-mao-v${ver}.txt` : null;
  const mdPath = `${folderPath}/entrega-v${ver}.md`;

  const codeFiles = Array.isArray(params.codeFiles) ? params.codeFiles : [];
  const usedCodePaths = new Set<string>();
  const codeFilePaths: Array<{ path: string; content: string }> = [];

  for (const f of codeFiles) {
    const rel = sanitizeGithubRelativePath(f.path, 'arquivo.txt');
    const full = `${folderPath}/codigo-v${ver}/${rel}`;
    const key = full.toLowerCase();
    if (usedCodePaths.has(key)) continue;
    usedCodePaths.add(key);
    codeFilePaths.push({ path: full, content: f.content });
  }

  const zipPath = codeFilePaths.length > 0 ? `${folderPath}/codigo-v${ver}.zip` : null;
  const cleanTitle = String(params.assignmentName || 'Trabalho')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 120);
  const commitMessage = `[${acronymSeg}] ${cleanTitle} - gerado (a verificar)`;

  return {
    folderPath,
    pdfPath,
    txtPath,
    mdPath,
    zipPath,
    codeFilePaths,
    commitMessage,
  };
}

/**
 * Garante que SOMENTE arquivos da entrega do aluno dentro da pasta esperada sejam enviados ao GitHub.
 * Aceita tanto `<semestre>/<sigla>/<trabalho>/...` quanto `pendentes/<semestre>/<sigla>/<trabalho>/...`.
 * Bloqueia qualquer tentativa de subir materiais de curso, anexos de professores ou dados do Canvas.
 */
export function assertDeliverableOnlyFiles(
  folderPath: string,
  files: GithubFileToCommit[]
): void {
  const cleanFolder = folderPath.replace(/\/+$/, '');
  const prefix = `${cleanFolder}/`;
  const allowedPattern =
    /^(?:pendentes\/)?([^/]+\/){3}(entrega-v\d+\.(md|pdf)|copiar-a-mao-v\d+\.txt|codigo-v\d+\.zip|codigo-v\d+\/.+)$/;

  for (const f of files) {
    if (!f.path.startsWith(prefix) || f.path.includes('..') || !allowedPattern.test(f.path)) {
      throw new Error(
        `Arquivo bloqueado por política de privacidade ("${f.path}"): somente entregas do aluno podem ser publicadas no GitHub.`
      );
    }
  }
}

/**
 * Valida caminhos a serem removidos atomicamente no commit (somente dentro de `pendentes/`).
 */
export function assertPendingDeleteOnlyPaths(deletePaths: string[]): void {
  const allowedPendingPattern =
    /^pendentes\/([^/]+\/){3}(entrega-v\d+\.(md|pdf)|copiar-a-mao-v\d+\.txt|codigo-v\d+\.zip|codigo-v\d+\/.+)$/;
  for (const p of deletePaths) {
    if (!p || p.includes('..') || !allowedPendingPattern.test(p)) {
      throw new Error(
        `Remoção bloqueada por segurança ("${p}"): somente arquivos em pendentes/ podem ser removidos automaticamente.`
      );
    }
  }
}

export function resolveCourseAcronym(course: {
  aliases?: string[];
  auto_aliases?: string[];
  course_code?: string;
  name?: string;
}): string {
  const manual = Array.isArray(course.aliases) ? course.aliases.find((a) => a && a.trim()) : null;
  if (manual) return manual.trim().toUpperCase();
  const auto = Array.isArray(course.auto_aliases) ? course.auto_aliases.find((a) => a && a.trim()) : null;
  if (auto) return auto.trim().toUpperCase();
  const code = (course.course_code || '').trim();
  if (code) return sanitizeGithubSegment(code, 'PUC', false, 16).toUpperCase();
  const norm = normalizeText(course.name || 'PUC').split(/\s+/).filter((w) => w.length > 2);
  return (norm.map((w) => w[0]).join('') || 'PUC').slice(0, 8).toUpperCase();
}

// ---- Persistência segura e Web Push de expiração (7 dias) / 401-403 ----

export async function maybeSendGithubTokenPush(
  db: Db,
  reason: 'expiring' | 'auth_error',
  detail?: number
): Promise<boolean> {
  const today = todayKey();
  const col = db.collection<GithubConfigDoc>('puc_github_config');
  const claim = await col.updateOne(
    { _id: CONFIG_DOC_ID, last_push_date: { $ne: today } },
    { $set: { last_push_date: today, last_push_reason: reason } }
  );
  if (claim.modifiedCount === 0) return false;

  const payload =
    reason === 'auth_error'
      ? {
          title: `PUC GitHub: token rejeitado (${detail || '401/403'})`,
          body: 'O token do GitHub falhou ao acessar o repositório privado. Atualize-o na aba GitHub da página PUC.',
          url: '/?page=puc',
        }
      : {
          title: 'PUC GitHub: token perto de expirar',
          body:
            typeof detail === 'number' && detail > 0
              ? `Seu token do GitHub expira em ${detail} dia(s). Gere um novo token fine-grained na página PUC.`
              : 'Seu token do GitHub está prestes a expirar. Atualize na página PUC.',
          url: '/?page=puc',
        };

  try {
    const ownerEmail = (process.env.EMAIL_VITOR || '').trim();
    let sent = 0;
    if (ownerEmail) {
      const res = await sendPushToUser(ownerEmail, payload);
      sent = res.sent;
    }
    if (sent === 0) {
      const res = await sendPushToAll(payload);
      sent = res.sent;
    }
    if (sent === 0) {
      await col.updateOne({ _id: CONFIG_DOC_ID, last_push_date: today }, { $set: { last_push_date: null } });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[puc/github/push] erro ao enviar alerta:', err instanceof Error ? err.message : String(err));
    await col.updateOne({ _id: CONFIG_DOC_ID, last_push_date: today }, { $set: { last_push_date: null } });
    return false;
  }
}

export async function markGithubAuthError(db: Db, status: 401 | 403): Promise<void> {
  await db.collection<GithubConfigDoc>('puc_github_config').updateOne(
    { _id: CONFIG_DOC_ID },
    { $set: { auth_error: status, last_auth_error_at: new Date() } }
  );
  await maybeSendGithubTokenPush(db, 'auth_error', status);
}

export async function saveGithubConfig(
  db: Db,
  params: {
    plainToken?: string;
    owner: string;
    repo: string;
    branch?: string;
    autoPublish?: boolean;
    expiresAt?: Date | null;
  }
): Promise<GithubConfigStatus> {
  const col = db.collection<GithubConfigDoc>('puc_github_config');
  const existing = await col.findOne({ _id: CONFIG_DOC_ID });
  const now = new Date();

  const patch: Record<string, unknown> = {
    owner: params.owner.trim(),
    repo: params.repo.trim(),
    branch: (params.branch || 'main').trim() || 'main',
    auto_publish: Boolean(params.autoPublish),
  };

  if (params.expiresAt !== undefined) {
    patch.expires_at = params.expiresAt;
  }

  if (params.plainToken && params.plainToken.trim()) {
    const encrypted = encryptGithubToken(params.plainToken.trim());
    Object.assign(patch, {
      ...encrypted,
      saved_at: now,
      auth_error: null,
      last_auth_error_at: null,
      last_push_date: null,
      last_push_reason: null,
    });
  } else if (!existing) {
    throw new Error('Informe o token fine-grained do GitHub.');
  }

  await col.updateOne({ _id: CONFIG_DOC_ID }, { $set: patch }, { upsert: true });
  return getGithubConfigStatus(db, now);
}

export async function getGithubTokenAndConfig(
  db: Db
): Promise<{ token: string | null; doc: GithubConfigDoc | null; decryptError?: boolean }> {
  const doc = await db.collection<GithubConfigDoc>('puc_github_config').findOne({ _id: CONFIG_DOC_ID });
  if (!doc) return { token: null, doc: null };
  try {
    const token = decryptGithubToken({ iv: doc.iv, tag: doc.tag, ciphertext: doc.ciphertext });
    return { token, doc };
  } catch {
    return { token: null, doc, decryptError: true };
  }
}

export async function getGithubConfigStatus(
  db: Db,
  now = new Date(),
  triggerExpiringPush = false
): Promise<GithubConfigStatus> {
  const doc = await db.collection<GithubConfigDoc>('puc_github_config').findOne({ _id: CONFIG_DOC_ID });
  if (!doc) {
    return {
      configured: false,
      owner: '',
      repo: '',
      branch: 'main',
      autoPublish: false,
      savedAt: null,
      expiresAt: null,
      daysRemaining: null,
      expiringSoon: false,
      expired: false,
      authError: null,
    };
  }

  let decryptError = false;
  try {
    decryptGithubToken({ iv: doc.iv, tag: doc.tag, ciphertext: doc.ciphertext });
  } catch {
    decryptError = true;
  }

  const savedAt = doc.saved_at instanceof Date ? doc.saved_at : new Date(doc.saved_at);
  const expiresAt = doc.expires_at ? (doc.expires_at instanceof Date ? doc.expires_at : new Date(doc.expires_at)) : null;
  const daysRemaining = expiresAt && !Number.isNaN(expiresAt.getTime()) ? computeDaysRemaining(expiresAt, now) : null;
  const authError = doc.auth_error === 401 || doc.auth_error === 403 ? doc.auth_error : null;
  const expired = decryptError || authError !== null || (daysRemaining !== null && daysRemaining <= 0);
  const expiringSoon = !expired && daysRemaining !== null && daysRemaining <= WARN_DAYS_THRESHOLD;

  if (triggerExpiringPush && expiringSoon && daysRemaining !== null) {
    await maybeSendGithubTokenPush(db, 'expiring', daysRemaining);
  }

  return {
    configured: true,
    ...(decryptError ? { decryptError: true } : {}),
    owner: doc.owner || '',
    repo: doc.repo || '',
    branch: doc.branch || 'main',
    autoPublish: Boolean(doc.auto_publish),
    savedAt: Number.isNaN(savedAt.getTime()) ? null : savedAt.toISOString(),
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
    daysRemaining,
    expiringSoon,
    expired,
    authError,
  };
}

// ---- Cliente HTTP GitHub com backoff em rate limit ----

async function githubFetch(
  endpoint: string,
  token: string,
  init: RequestInit = {},
  opts: {
    fetchImpl?: FetchLike;
    onAuthError?: (status: 401 | 403) => Promise<void>;
    accept?: string;
    sleepFn?: (ms: number) => Promise<void>;
  } = {}
): Promise<Response> {
  const fetchFn = opts.fetchImpl || fetch;
  const sleepFn = opts.sleepFn || sleep;
  const url = `${getApiBaseUrl()}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  let attempt = 0;
  while (true) {
    const res = await fetchFn(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: opts.accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wall-dashboard-puc-assistant',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });

    const rateRemaining = res.headers?.get?.('x-ratelimit-remaining');
    const isRateLimited =
      res.status === 429 || (res.status === 403 && rateRemaining === '0');

    if (isRateLimited && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterSec = Number(res.headers?.get?.('retry-after') || '');
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 15_000)
          : Math.min(800 * Math.pow(2, attempt), 8_000);
      attempt += 1;
      await sleepFn(waitMs);
      continue;
    }

    if ((res.status === 401 || (res.status === 403 && !isRateLimited)) && opts.onAuthError) {
      await opts.onAuthError(res.status as 401 | 403);
    }

    return res;
  }
}

async function githubJson<T>(
  endpoint: string,
  token: string,
  init: RequestInit = {},
  opts?: Parameters<typeof githubFetch>[3]
): Promise<T> {
  const res = await githubFetch(endpoint, token, init, opts);
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) detail = `: ${body.message}`;
    } catch {
      // ignore
    }
    throw new GithubApiError(res.status, endpoint, `GitHub API HTTP ${res.status}${detail}`);
  }
  return (await res.json()) as T;
}

// ---- Testar conexão (exige repo PRIVADO + escrita) ----

export async function testGithubConnection(
  params: { token: string; owner: string; repo: string; branch?: string },
  opts: { fetchImpl?: FetchLike; onAuthError?: (status: 401 | 403) => Promise<void> } = {}
): Promise<GithubConnectionTestResult> {
  const owner = params.owner.trim();
  const repo = params.repo.trim();
  const branch = (params.branch || 'main').trim() || 'main';
  if (!owner || !repo || !/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
    throw new Error('Owner ou nome do repositório GitHub inválido.');
  }

  const repoInfo = await githubJson<{
    private?: boolean;
    default_branch?: string;
    html_url?: string;
    permissions?: { push?: boolean; admin?: boolean; pull?: boolean };
  }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, params.token, { method: 'GET' }, opts);

  if (repoInfo.private !== true) {
    throw new Error(
      'Repositório público recusado por segurança. Configure um repositório GitHub PRIVADO para guardar suas entregas.'
    );
  }

  const canPush = Boolean(repoInfo.permissions?.push || repoInfo.permissions?.admin);
  if (!canPush) {
    throw new Error(
      'Token sem permissão de escrita (Contents: Read and write) neste repositório privado.'
    );
  }

  // Confirma acesso à branch configurada (ou aceita se branch existir)
  const refRes = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
    params.token,
    { method: 'GET' },
    opts
  );
  if (!refRes.ok && refRes.status !== 409) {
    // 409 = repo vazio sem commits ainda; 404 = branch não existe
    if (refRes.status === 404) {
      throw new Error(
        `A branch "${branch}" não foi encontrada no repositório (branch padrão: ${repoInfo.default_branch || 'main'}). Crie pelo menos um commit inicial na branch.`
      );
    }
    throw new GithubApiError(refRes.status, `/git/ref/heads/${branch}`);
  }

  return {
    ok: true,
    owner,
    repo,
    branch,
    isPrivate: true,
    defaultBranch: repoInfo.default_branch || 'main',
    htmlUrl: repoInfo.html_url || `https://github.com/${owner}/${repo}`,
    permissions: {
      push: Boolean(repoInfo.permissions?.push),
      admin: Boolean(repoInfo.permissions?.admin),
    },
  };
}

// ---- Publicação atômica via Git Data API (com retry em conflito de SHA) ----

export async function publishDeliverableToGithub(
  params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    folderPath: string;
    commitMessage: string;
    files: GithubFileToCommit[];
    deletePaths?: string[];
  },
  opts: {
    fetchImpl?: FetchLike;
    onAuthError?: (status: 401 | 403) => Promise<void>;
    sleepFn?: (ms: number) => Promise<void>;
  } = {}
): Promise<GithubPublishResult> {
  if (params.files.length === 0) {
    throw new Error('Nenhum arquivo fornecido para publicação no GitHub.');
  }

  // Validação rígida de tamanho (50 MB) antes de qualquer chamada de rede
  for (const f of params.files) {
    if (f.content.byteLength > MAX_GITHUB_FILE_BYTES) {
      const mb = (f.content.byteLength / (1024 * 1024)).toFixed(1);
      throw new Error(
        `O arquivo "${f.path}" (${mb} MB) excede o limite de 50 MB permitido para publicação no GitHub.`
      );
    }
  }

  // Garante que apenas arquivos da entrega sejam enviados (nunca anexos/dados do Canvas)
  assertDeliverableOnlyFiles(params.folderPath, params.files);

  const uniqueDeletePaths = Array.isArray(params.deletePaths)
    ? Array.from(new Set(params.deletePaths.filter((p) => typeof p === 'string' && p.trim().length > 0)))
    : [];
  if (uniqueDeletePaths.length > 0) {
    assertPendingDeleteOnlyPaths(uniqueDeletePaths);
  }

  const baseRepoPath = `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`;

  // 1. Validar que o repositório continua privado antes de subir dados do aluno
  const repoInfo = await githubJson<{ private?: boolean }>(baseRepoPath, params.token, { method: 'GET' }, opts);
  if (repoInfo.private !== true) {
    throw new Error(
      'Publicação recusada: o repositório configurado não é privado. Torne-o privado antes de publicar.'
    );
  }

  // 2. Criar todos os blobs uma única vez (reutilizáveis em retries de conflito de SHA!)
  const blobEntries: Array<{ path: string; sha: string }> = [];
  for (const file of params.files) {
    const blob = await githubJson<{ sha: string }>(
      `${baseRepoPath}/git/blobs`,
      params.token,
      {
        method: 'POST',
        body: JSON.stringify({
          content: file.content.toString('base64'),
          encoding: 'base64',
        }),
      },
      opts
    );
    blobEntries.push({ path: file.path, sha: blob.sha });
  }

  // 3. Criar tree, commit e atualizar ref atomicamente com retry em conflito de SHA (409/422)
  let retriesUsed = 0;
  while (true) {
    const refData = await githubJson<{ object: { sha: string } }>(
      `${baseRepoPath}/git/ref/heads/${encodeURIComponent(params.branch)}`,
      params.token,
      { method: 'GET' },
      opts
    );
    const headCommitSha = refData.object.sha;

    const headCommit = await githubJson<{ tree: { sha: string } }>(
      `${baseRepoPath}/git/commits/${headCommitSha}`,
      params.token,
      { method: 'GET' },
      opts
    );

    const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [
      ...blobEntries.map((b) => ({
        path: b.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: b.sha,
      })),
      ...uniqueDeletePaths.map((p) => ({
        path: p,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: null,
      })),
    ];

    const newTree = await githubJson<{ sha: string }>(
      `${baseRepoPath}/git/trees`,
      params.token,
      {
        method: 'POST',
        body: JSON.stringify({
          base_tree: headCommit.tree.sha,
          tree: treeEntries,
        }),
      },
      opts
    );

    const newCommit = await githubJson<{ sha: string; html_url?: string }>(
      `${baseRepoPath}/git/commits`,
      params.token,
      {
        method: 'POST',
        body: JSON.stringify({
          message: params.commitMessage,
          tree: newTree.sha,
          parents: [headCommitSha],
        }),
      },
      opts
    );

    const patchRes = await githubFetch(
      `${baseRepoPath}/git/refs/heads/${encodeURIComponent(params.branch)}`,
      params.token,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      },
      opts
    );

    if (patchRes.ok) {
      return {
        commitSha: newCommit.sha,
        htmlUrl: `https://github.com/${params.owner}/${params.repo}/commit/${newCommit.sha}`,
        folderUrl: `https://github.com/${params.owner}/${params.repo}/tree/${encodeURIComponent(params.branch)}/${params.folderPath}`,
        branch: params.branch,
        paths: blobEntries.map((b) => b.path),
        ...(uniqueDeletePaths.length > 0 ? { deletedPaths: uniqueDeletePaths } : {}),
        retriesUsed,
      };
    }

    // Conflito de SHA / non-fast-forward (409 ou 422): relê HEAD e tenta novamente
    if ((patchRes.status === 409 || patchRes.status === 422) && retriesUsed < MAX_SHA_CONFLICT_RETRIES) {
      retriesUsed += 1;
      await (opts.sleepFn || sleep)(250 * retriesUsed);
      continue;
    }

    let detail = '';
    try {
      const body = (await patchRes.json()) as { message?: string };
      if (body?.message) detail = `: ${body.message}`;
    } catch {
      // ignore
    }
    throw new GithubApiError(
      patchRes.status,
      `/git/refs/heads/${params.branch}`,
      `Falha ao atualizar branch no GitHub (HTTP ${patchRes.status}${detail})`
    );
  }
}

// ---- Download de arquivo já publicado no GitHub (para reuso em downloads) ----

export async function fetchGithubPublishedFile(
  params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    path: string;
  },
  opts: { fetchImpl?: FetchLike; onAuthError?: (status: 401 | 403) => Promise<void> } = {}
): Promise<Buffer | null> {
  const encodedPath = params.path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const res = await githubFetch(
    `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(params.branch)}`,
    params.token,
    { method: 'GET' },
    { ...opts, accept: 'application/vnd.github.raw+json' }
  );
  if (!res.ok) return null;
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}
