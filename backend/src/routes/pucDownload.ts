import { Archiver, ArchiverError, ZipArchive } from 'archiver';
import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import type { Db } from 'mongodb';
import { CanvasApiError, getCanvasFileMeta } from '../lib/canvasApi';
import { getCanvasToken, markCanvasToken401 } from '../lib/canvasAuth';
import { getDb } from '../lib/mongo';
import { safeEqual } from '../middleware/auth';

const DOWNLOAD_TOKEN_TTL_SEC = 120;
const MAX_SEGMENT_LEN = 150;
const FILE_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Remove caracteres proibidos em sistemas de arquivos (`\ / : * ? " < > |`),
 * caracteres de controle e limita o segmento a 150 caracteres preservando extensão.
 */
export function sanitizeSegment(raw: string, fallback = 'sem_nome', preserveExtension = false): string {
  const cleaned = String(raw || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();

  const base = cleaned || fallback;
  if (base.length <= MAX_SEGMENT_LEN) return base;

  if (preserveExtension) {
    const dot = base.lastIndexOf('.');
    if (dot > 0 && base.length - dot <= 16) {
      const ext = base.slice(dot);
      const stem = base.slice(0, MAX_SEGMENT_LEN - ext.length).trim();
      return `${stem || fallback}${ext}`;
    }
  }
  return base.slice(0, MAX_SEGMENT_LEN).trim() || fallback;
}

export function sanitizeFolderPath(rawPath: string): string {
  const parts = String(rawPath || '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeSegment(segment, 'pasta'));
  return parts.length > 0 ? parts.join('/') : 'Raiz';
}

export function makeUniqueZipPath(
  usedPaths: Set<string>,
  dirPath: string,
  fileName: string
): string {
  const safeName = sanitizeSegment(fileName, 'arquivo', true);
  const prefix = dirPath ? `${dirPath}/` : '';
  const initial = `${prefix}${safeName}`;
  const initialKey = initial.toLowerCase();
  if (!usedPaths.has(initialKey)) {
    usedPaths.add(initialKey);
    return initial;
  }

  const dot = safeName.lastIndexOf('.');
  const hasExt = dot > 0 && safeName.length - dot <= 16;
  const stem = hasExt ? safeName.slice(0, dot) : safeName;
  const ext = hasExt ? safeName.slice(dot) : '';

  let counter = 2;
  while (true) {
    const suffix = ` (${counter})`;
    const maxStemLen = Math.max(1, MAX_SEGMENT_LEN - ext.length - suffix.length);
    const candidate = `${prefix}${stem.slice(0, maxStemLen)}${suffix}${ext}`;
    const key = candidate.toLowerCase();
    if (!usedPaths.has(key)) {
      usedPaths.add(key);
      return candidate;
    }
    counter += 1;
  }
}

function getSigningSecret(): string {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.API_TOKEN;
  if (!secret) throw new Error('download_signing_secret_not_configured');
  return secret;
}

/**
 * Gera um token HMAC de curta duração (120s) vinculado exclusivamente a um path de download.
 * Evita expor API_TOKEN ou JWT na query string durante downloads nativos do navegador.
 */
export function signDownloadToken(targetPath: string): { token: string; expiresIn: number } {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SEC;
  const payload = Buffer.from(JSON.stringify({ p: targetPath, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, expiresIn: DOWNLOAD_TOKEN_TTL_SEC };
}

export function verifyDownloadToken(token: string, expectedPath: string): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expectedSig: string;
  try {
    expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  } catch {
    return false;
  }
  if (!safeEqual(sig, expectedSig)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      p?: string;
      exp?: number;
    };
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return false;
    return parsed.p === expectedPath;
  } catch {
    return false;
  }
}

function buildPageHtmlDocument(title: string, body: string, htmlUrl?: string | null): string {
  const escapedTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const sourceNote = htmlUrl
    ? `<p style="font-size:12px;color:#666">Origem: <a href="${htmlUrl}">${htmlUrl}</a></p><hr/>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapedTitle}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1b1f23}img{max-width:100%;height:auto}pre,code{background:#f4f6f8;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
<h1>${escapedTitle}</h1>
${sourceNote}
${body || '<p><em>Página sem conteúdo.</em></p>'}
</body>
</html>`;
}

async function appendFileFromCanvas(
  archive: Archiver,
  zipEntryPath: string,
  fileId: number,
  canvasToken: string,
  onUnauthorized: () => Promise<void>
): Promise<void> {
  const meta = await getCanvasFileMeta(fileId, canvasToken, { onUnauthorized });
  if (!meta.url) {
    throw new Error('URL de download ausente na resposta do Canvas');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILE_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(meta.url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} ao baixar arquivo`);
    }
    const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream);

    await new Promise<void>((resolve, reject) => {
      nodeStream.once('end', resolve);
      nodeStream.once('error', reject);
      archive.append(nodeStream, { name: zipEntryPath });
    });
  } finally {
    clearTimeout(timer);
  }
}

async function appendCourseToArchive(
  db: Db,
  archive: Archiver,
  course: any,
  courseRootPrefix: string,
  canvasToken: string,
  onUnauthorized: () => Promise<void>,
  usedPaths: Set<string>,
  failures: string[]
): Promise<void> {
  const courseId = Number(course.canvas_id);
  const [files, pages, modules] = await Promise.all([
    db.collection('canvas_files').find({ course_id: courseId }).toArray(),
    db.collection('canvas_pages').find({ course_id: courseId }).toArray(),
    db.collection('canvas_modules').find({ course_id: courseId }).sort({ position: 1 }).toArray(),
  ]);

  // 1. Páginas HTML (_paginas/<Título>.html)
  for (const page of pages) {
    const pageTitle = String(page.title || page.slug || 'pagina');
    const htmlFileName = `${sanitizeSegment(pageTitle, 'pagina')}.html`;
    const entryPath = makeUniqueZipPath(usedPaths, `${courseRootPrefix}/_paginas`, htmlFileName);
    const htmlDoc = buildPageHtmlDocument(pageTitle, String(page.body || ''), page.html_url);
    archive.append(htmlDoc, { name: entryPath });
  }

  // 2. Links externos dos módulos (_links_externos.txt)
  const linkLines: string[] = [];
  for (const mod of modules) {
    const items = Array.isArray(mod.items) ? mod.items : [];
    const extItems = items.filter(
      (item: any) => item?.type === 'ExternalUrl' && typeof item?.external_url === 'string' && item.external_url
    );
    if (extItems.length === 0) continue;
    linkLines.push(`=== ${String(mod.name || 'Módulo')} ===`);
    for (const item of extItems) {
      linkLines.push(`${String(item.title || 'Link')}: ${item.external_url}`);
    }
    linkLines.push('');
  }
  if (linkLines.length > 0) {
    const entryPath = makeUniqueZipPath(usedPaths, courseRootPrefix, '_links_externos.txt');
    archive.append(linkLines.join('\n'), { name: entryPath });
  }

  // 3. Arquivos (_arquivos/<Pasta ou Módulo>/<arquivo>) em streaming
  for (const f of files) {
    const folderRel = sanitizeFolderPath(String(f.origin_path || 'Raiz'));
    const displayName = String(f.display_name || f.filename || `arquivo-${f.canvas_id}`);
    const entryPath = makeUniqueZipPath(
      usedPaths,
      `${courseRootPrefix}/_arquivos/${folderRel}`,
      displayName
    );
    try {
      await appendFileFromCanvas(archive, entryPath, Number(f.canvas_id), canvasToken, onUnauthorized);
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 401) {
        failures.push(`[401] ${entryPath} (id=${f.canvas_id}): Token expirado`);
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${entryPath} (id=${f.canvas_id}): ${msg}`);
    }
  }
}

export function createPucDownloadRouter(
  pucAuth: (req: Request, res: Response, next: NextFunction) => void
): Router {
  const r = Router();

  // Aceita header padrão (x-api-token ou JWT owner) OU ?dt=<token curto assinado>
  const downloadAuth = (req: Request, res: Response, next: NextFunction): void => {
    const dt = typeof req.query.dt === 'string' ? req.query.dt : '';
    const cleanPath = req.originalUrl.split('?')[0];
    if (dt && verifyDownloadToken(dt, cleanPath)) {
      next();
      return;
    }
    pucAuth(req, res, next);
  };

  // Emite token de download de curta duração (120s) para evitar expor API_TOKEN/JWT na URL
  r.post('/download-token', pucAuth, (req, res) => {
    const rawPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const allowed =
      /^\/api\/puc\/download-all\.zip$/.test(rawPath) ||
      /^\/api\/puc\/\d+\/download\.zip$/.test(rawPath) ||
      /^\/api\/puc\/files\/\d+\/download$/.test(rawPath) ||
      /^\/api\/puc\/assistant\/deliverables\/\d+\/\d+\/export\.(pdf|md|zip)$/.test(rawPath);

    if (!allowed) {
      res.status(400).json({ error: 'caminho_download_invalido' });
      return;
    }
    res.json(signDownloadToken(rawPath));
  });

  // Download individual de arquivo: busca URL fresca no Canvas e redireciona
  r.get('/files/:fid/download', downloadAuth, async (req, res, next) => {
    try {
      const fidRaw = req.params.fid;
      if (!/^\d+$/.test(fidRaw)) {
        res.status(400).json({ error: 'file_id_invalido' });
        return;
      }
      const fid = Number(fidRaw);
      const db = await getDb();
      const auth = await getCanvasToken(db);
      if (!auth.token) {
        res.status(400).json({ error: 'canvas_token_nao_configurado' });
        return;
      }

      const meta = await getCanvasFileMeta(fid, auth.token, {
        onUnauthorized: () => markCanvasToken401(db),
      });
      if (!meta.url) {
        res.status(404).json({ error: 'url_arquivo_indisponivel' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, meta.url);
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 401) {
        res.status(401).json({ error: 'canvas_token_expirado' });
        return;
      }
      if (err instanceof CanvasApiError && (err.status === 403 || err.status === 404)) {
        res.status(err.status).json({ error: 'arquivo_indisponivel_no_canvas' });
        return;
      }
      next(err);
    }
  });

  // ZIP em streaming de um único curso
  r.get('/:cid/download.zip', downloadAuth, async (req, res, next) => {
    try {
      const cidRaw = req.params.cid;
      if (!/^\d+$/.test(cidRaw)) {
        res.status(400).json({ error: 'course_id_invalido' });
        return;
      }
      const cid = Number(cidRaw);
      const db = await getDb();
      const [course, auth] = await Promise.all([
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        getCanvasToken(db),
      ]);

      if (!course) {
        res.status(404).json({ error: 'curso_nao_encontrado' });
        return;
      }
      if (!auth.token) {
        res.status(400).json({ error: 'canvas_token_nao_configurado' });
        return;
      }

      const courseFolder = sanitizeSegment(String(course.name || `curso-${cid}`), `curso-${cid}`);
      const zipFileName = `${courseFolder}.zip`;

      req.setTimeout(0);
      res.setTimeout(0);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');

      const archive = new ZipArchive({ zlib: { level: 5 } });
      archive.on('warning', (warn: ArchiverError) => {
        if (warn.code !== 'ENOENT') console.warn('[puc/zip] warning:', warn.message);
      });
      archive.on('error', (err: ArchiverError) => {
        console.error('[puc/zip] error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'zip_error' });
        else res.end();
      });

      archive.pipe(res);

      let unauthorizedHandled = false;
      const onUnauthorized = async () => {
        if (unauthorizedHandled) return;
        unauthorizedHandled = true;
        await markCanvasToken401(db);
      };

      const usedPaths = new Set<string>();
      const failures: string[] = [];

      try {
        await appendCourseToArchive(
          db,
          archive,
          course,
          courseFolder,
          auth.token,
          onUnauthorized,
          usedPaths,
          failures
        );
      } catch (err) {
        if (!(err instanceof CanvasApiError && err.status === 401)) {
          failures.push(`Erro geral no curso ${courseFolder}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (failures.length > 0) {
        archive.append(
          `Alguns arquivos não puderam ser baixados:\n\n${failures.join('\n')}\n`,
          { name: `${courseFolder}/_falhas.txt` }
        );
      }

      await archive.finalize();
    } catch (err) {
      next(err);
    }
  });

  // ZIP em streaming de todos os cursos visíveis, organizados por <Semestre>/<Curso>/...
  r.get('/download-all.zip', downloadAuth, async (req, res, next) => {
    try {
      const db = await getDb();
      const [courses, auth] = await Promise.all([
        db.collection('canvas_courses').find({ active: true, hidden: { $ne: true }, has_grades: true }).toArray(),
        getCanvasToken(db),
      ]);

      if (!auth.token) {
        res.status(400).json({ error: 'canvas_token_nao_configurado' });
        return;
      }
      if (courses.length === 0) {
        res.status(404).json({ error: 'nenhum_curso_visivel' });
        return;
      }

      req.setTimeout(0);
      res.setTimeout(0);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="PUC_Cursos.zip"');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');

      const archive = new ZipArchive({ zlib: { level: 5 } });
      archive.on('warning', (warn: ArchiverError) => {
        if (warn.code !== 'ENOENT') console.warn('[puc/zip-all] warning:', warn.message);
      });
      archive.on('error', (err: ArchiverError) => {
        console.error('[puc/zip-all] error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'zip_error' });
        else res.end();
      });

      archive.pipe(res);

      let unauthorizedHandled = false;
      const onUnauthorized = async () => {
        if (unauthorizedHandled) return;
        unauthorizedHandled = true;
        await markCanvasToken401(db);
      };

      const usedPaths = new Set<string>();
      const usedCourseRoots = new Set<string>();
      const failures: string[] = [];

      for (const course of courses) {
        const termFolder = sanitizeSegment(String(course.term_name || 'Sem semestre'), 'Sem semestre');
        const baseCourseFolder = sanitizeSegment(
          String(course.name || `curso-${course.canvas_id}`),
          `curso-${course.canvas_id}`
        );
        let rootPrefix = `${termFolder}/${baseCourseFolder}`;
        if (usedCourseRoots.has(rootPrefix.toLowerCase())) {
          rootPrefix = `${termFolder}/${sanitizeSegment(`${baseCourseFolder} (${course.canvas_id})`)}`;
        }
        usedCourseRoots.add(rootPrefix.toLowerCase());

        try {
          await appendCourseToArchive(
            db,
            archive,
            course,
            rootPrefix,
            auth.token,
            onUnauthorized,
            usedPaths,
            failures
          );
        } catch (err) {
          if (err instanceof CanvasApiError && err.status === 401) {
            break;
          }
          failures.push(
            `Erro geral no curso ${rootPrefix}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (failures.length > 0) {
        archive.append(
          `Alguns arquivos não puderam ser baixados:\n\n${failures.join('\n')}\n`,
          { name: '_falhas.txt' }
        );
      }

      await archive.finalize();
    } catch (err) {
      next(err);
    }
  });

  return r;
}
