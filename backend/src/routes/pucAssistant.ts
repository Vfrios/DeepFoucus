import { NextFunction, Request, Response, Router } from 'express';
import { getCanvasToken, markCanvasToken401 } from '../lib/canvasAuth';
import { getDb } from '../lib/mongo';
import {
  AiProviderId,
  ConcreteProviderId,
  downloadAndExtractCanvasAttachment,
  generateDeliverable,
  listConfiguredProviders,
  reviewDeliverable,
} from '../lib/pucAssistantAi';
import {
  AssignmentKind,
  AssignmentRecord,
  buildDeliverableContext,
  canExportDeliverable,
  canGenerateForPart,
  classifyAssignmentsForCourse,
  computePartTimelineState,
  CourseLessonSummary,
  DELIVERABLE_STATUS_LABEL,
  DeliverableStatus,
  extractCodeFilesFromMarkdown,
  ExtractedAttachmentText,
  findPendingPlaceholders,
  MultiPartProjectSpec,
  PART_TIMELINE_LABEL,
  PreviousPartApprovedInput,
  PreviousSubmissionInput,
  sanitizeHtmlToText,
} from '../lib/pucAssistantCore';
import {
  generateDeliverableCodeZipBuffer,
  generateDeliverablePdfBuffer,
} from '../lib/pucAssistantPdf';
import {
  buildDeliverableGithubPaths,
  fetchGithubPublishedFile,
  getGithubConfigStatus,
  getGithubTokenAndConfig,
  GithubApiError,
  GithubFileToCommit,
  markGithubAuthError,
  publishDeliverableToGithub,
  resolveCourseAcronym,
  saveGithubConfig,
  sha256Text,
  testGithubConnection,
} from '../lib/pucGithub';
import { sanitizeSegment, verifyDownloadToken } from './pucDownload';
import type { Db } from 'mongodb';

// Rate limit em memória para geração/revisão com IA (10 req / 5 min por usuário/IP)
const AI_GEN_WINDOW_MS = 5 * 60_000;
const AI_GEN_MAX_REQUESTS = 10;
const aiGenHits = new Map<string, number[]>();

function checkAiGenRateLimit(key: string): boolean {
  const now = Date.now();
  const prev = (aiGenHits.get(key) || []).filter((ts) => now - ts < AI_GEN_WINDOW_MS);
  if (prev.length >= AI_GEN_MAX_REQUESTS) {
    aiGenHits.set(key, prev);
    return false;
  }
  prev.push(now);
  aiGenHits.set(key, prev);
  if (aiGenHits.size > 200) {
    for (const [k, v] of aiGenHits.entries()) {
      if (v.every((ts) => now - ts >= AI_GEN_WINDOW_MS)) aiGenHits.delete(k);
    }
  }
  return true;
}

// Rate limit para rotas GitHub (15 req / 5 min por usuário/IP)
const GITHUB_MAX_REQUESTS = 15;
const githubHits = new Map<string, number[]>();

function checkGithubRateLimit(key: string): boolean {
  const now = Date.now();
  const prev = (githubHits.get(key) || []).filter((ts) => now - ts < AI_GEN_WINDOW_MS);
  if (prev.length >= GITHUB_MAX_REQUESTS) {
    githubHits.set(key, prev);
    return false;
  }
  prev.push(now);
  githubHits.set(key, prev);
  if (githubHits.size > 200) {
    for (const [k, v] of githubHits.entries()) {
      if (v.every((ts) => now - ts >= AI_GEN_WINDOW_MS)) githubHits.delete(k);
    }
  }
  return true;
}

async function tryFetchFromGithubIfUnchanged(
  db: Db,
  deliverable: any,
  kind: 'pdf' | 'md' | 'zip'
): Promise<Buffer | null> {
  const currentMarkdown = String(deliverable?.current_markdown || '');
  const currentHash = sha256Text(currentMarkdown);
  const publications = Array.isArray(deliverable?.publications) ? deliverable.publications : [];
  const latestPub = publications[publications.length - 1];
  if (!latestPub || latestPub.contentHash !== currentHash) return null;

  const targetPath =
    kind === 'pdf' ? latestPub.pdfPath : kind === 'md' ? latestPub.mdPath : latestPub.zipPath;
  if (!targetPath) return null;

  const gh = await getGithubTokenAndConfig(db);
  if (!gh.token || !gh.doc) return null;

  try {
    return await fetchGithubPublishedFile(
      {
        token: gh.token,
        owner: gh.doc.owner,
        repo: gh.doc.repo,
        branch: gh.doc.branch || 'main',
        path: targetPath,
      },
      {
        onAuthError: (st) => markGithubAuthError(db, st),
      }
    );
  } catch {
    return null;
  }
}

async function executeGithubPublish(db: Db, cid: number, aid: number) {
  const [deliverable, assignment, course, tokenDoc, gh] = await Promise.all([
    db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
    db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
    db.collection('canvas_courses').findOne({ canvas_id: cid }),
    db.collection('canvas_auth').findOne({ _id: 'puc' as any }),
    getGithubTokenAndConfig(db),
  ]);

  if (!deliverable) {
    throw Object.assign(new Error('Entrega não encontrada.'), { httpStatus: 404 });
  }
  if (!gh.doc || !gh.token) {
    throw Object.assign(
      new Error('GitHub privado não configurado. Configure o token e repositório na aba GitHub da página PUC.'),
      { httpStatus: 400 }
    );
  }

  const markdown = String(deliverable.current_markdown || '');
  const gate = canExportDeliverable(deliverable.status, markdown);
  if (!gate.allowed) {
    throw Object.assign(
      new Error(gate.reasons[0] || 'Entrega bloqueada para publicação no GitHub.'),
      { httpStatus: 400, reasons: gate.reasons, pendingPlaceholders: gate.pendingPlaceholders }
    );
  }

  const courseName = String(course?.name || assignment?.course_name || deliverable.course_name || `Curso ${cid}`);
  const assignmentName = String(assignment?.name || deliverable.assignment_name || `Trabalho ${aid}`);
  const studentName = String(deliverable.student_name || tokenDoc?.canvas_user_name || 'Aluno PUC Minas');
  const groupMembers =
    Array.isArray(deliverable.group_members) && deliverable.group_members.length > 0
      ? deliverable.group_members
      : Array.isArray(course?.group_members)
        ? course.group_members
        : [];

  const nextVersion = Number(deliverable.last_published_version || 0) + 1;
  const codeFiles = extractCodeFilesFromMarkdown(markdown);
  const paths = buildDeliverableGithubPaths({
    semester: String(course?.term_name || 'sem-semestre'),
    courseAcronym: resolveCourseAcronym({
      aliases: course?.aliases,
      auto_aliases: course?.auto_aliases,
      course_code: course?.course_code,
      name: courseName,
    }),
    assignmentName,
    version: nextVersion,
    codeFiles,
  });

  // Gera PDF, MD e (se houver código) arquivos individuais + ZIP em memória
  const pdfBuffer = await generateDeliverablePdfBuffer({
    courseName,
    assignmentName,
    studentName,
    groupMembers,
    markdown,
  });

  const filesToCommit: GithubFileToCommit[] = [
    { path: paths.pdfPath, content: pdfBuffer },
    { path: paths.mdPath, content: Buffer.from(markdown, 'utf8') },
  ];

  if (paths.codeFilePaths.length > 0 && paths.zipPath) {
    for (const cf of paths.codeFilePaths) {
      filesToCommit.push({ path: cf.path, content: Buffer.from(cf.content, 'utf8') });
    }
    const zipBuffer = await generateDeliverableCodeZipBuffer({
      assignmentName,
      markdown,
      explicitFiles: codeFiles,
    });
    filesToCommit.push({ path: paths.zipPath, content: zipBuffer });
  }

  // Publicação atômica no GitHub privado (não altera Mongo se falhar)
  const published = await publishDeliverableToGithub(
    {
      token: gh.token,
      owner: gh.doc.owner,
      repo: gh.doc.repo,
      branch: gh.doc.branch || 'main',
      folderPath: paths.folderPath,
      commitMessage: paths.commitMessage,
      files: filesToCommit,
    },
    {
      onAuthError: (st) => markGithubAuthError(db, st),
    }
  );

  const now = new Date();
  const contentHash = sha256Text(markdown);
  const pubRecord = {
    version: nextVersion,
    commitSha: published.commitSha,
    htmlUrl: published.htmlUrl,
    folderUrl: published.folderUrl,
    pdfPath: paths.pdfPath,
    mdPath: paths.mdPath,
    zipPath: paths.zipPath,
    codePaths: paths.codeFilePaths.map((c) => c.path),
    publishedAt: now.toISOString(),
    contentHash,
  };

  const prevPubs = Array.isArray(deliverable.publications) ? deliverable.publications : [];
  const updatedPubs = [...prevPubs, pubRecord].slice(-50);

  // Limpeza do Mongo: mantém só texto atual, status e metadados; versões antigas ficam apenas no GitHub!
  await db.collection('puc_deliverables').updateOne(
    { course_id: cid, assignment_id: aid },
    {
      $set: {
        content_hash: contentHash,
        last_published_version: nextVersion,
        last_published_hash: contentHash,
        last_published_sha: published.commitSha,
        last_published_url: published.htmlUrl,
        last_published_folder_url: published.folderUrl,
        last_published_at: now,
        publications: updatedPubs,
        versions: [],
        updated_at: now,
      },
    }
  );

  return {
    publication: pubRecord,
    publications: updatedPubs,
    retriesUsed: published.retriesUsed,
  };
}

function parseNumericId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseProvider(raw: unknown): AiProviderId {
  if (raw === 'gemini' || raw === 'groq' || raw === 'openrouter' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

function parseStatus(raw: unknown): DeliverableStatus | null {
  if (raw === 'entrega_gerada' || raw === 'revisada_por_mim' || raw === 'pronta') {
    return raw;
  }
  return null;
}

function cleanGroupMembers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 80);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.slice(0, 15);
}

export function createPucAssistantRouter(
  pucAuth: (req: Request, res: Response, next: NextFunction) => void
): Router {
  const r = Router();

  const downloadAuth = (req: Request, res: Response, next: NextFunction): void => {
    const dt = typeof req.query.dt === 'string' ? req.query.dt : '';
    const cleanPath = req.originalUrl.split('?')[0];
    if (dt && verifyDownloadToken(dt, cleanPath)) {
      next();
      return;
    }
    pucAuth(req, res, next);
  };

  // ---- Exportações em memória (suportam ?dt= download token) ----

  // GET /api/puc/assistant/deliverables/:cid/:aid/export.pdf
  r.get('/deliverables/:cid/:aid/export.pdf', downloadAuth, async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const db = await getDb();
      const [deliverable, assignment, course, tokenDoc] = await Promise.all([
        db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        db.collection('canvas_auth').findOne({ _id: 'puc' as any }),
      ]);

      if (!deliverable) {
        res.status(404).json({ error: 'entrega_nao_encontrada' });
        return;
      }

      const markdown = String(deliverable.current_markdown || '');
      const gate = canExportDeliverable(deliverable.status, markdown);
      if (!gate.allowed) {
        res.status(400).json({
          error: gate.reasons[0] || 'exportacao_bloqueada',
          reasons: gate.reasons,
          pendingPlaceholders: gate.pendingPlaceholders,
        });
        return;
      }

      const courseName = String(course?.name || assignment?.course_name || `Curso ${cid}`);
      const assignmentName = String(assignment?.name || deliverable.assignment_name || `Trabalho ${aid}`);

      // Se já publicada no GitHub e o texto não mudou desde o commit, serve direto do GitHub
      const fromGithub = await tryFetchFromGithubIfUnchanged(db, deliverable, 'pdf');
      const pdfBuffer =
        fromGithub ||
        (await generateDeliverablePdfBuffer({
          courseName,
          assignmentName,
          studentName: String(deliverable.student_name || tokenDoc?.canvas_user_name || 'Aluno PUC Minas'),
          groupMembers:
            Array.isArray(deliverable.group_members) && deliverable.group_members.length > 0
              ? deliverable.group_members
              : Array.isArray(course?.group_members)
                ? course.group_members
                : [],
          markdown,
        }));

      const fileName = `${sanitizeSegment(assignmentName, `entrega-${aid}`)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/puc/assistant/deliverables/:cid/:aid/export.md
  r.get('/deliverables/:cid/:aid/export.md', downloadAuth, async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }
      const db = await getDb();
      const deliverable = await db
        .collection('puc_deliverables')
        .findOne({ course_id: cid, assignment_id: aid });
      if (!deliverable) {
        res.status(404).json({ error: 'entrega_nao_encontrada' });
        return;
      }

      const markdown = String(deliverable.current_markdown || '');
      const fileName = `${sanitizeSegment(String(deliverable.assignment_name || `entrega-${aid}`), `entrega-${aid}`)}.md`;
      const fromGithub = await tryFetchFromGithubIfUnchanged(db, deliverable, 'md');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fromGithub ? fromGithub.toString('utf8') : markdown);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/puc/assistant/deliverables/:cid/:aid/export.zip
  r.get('/deliverables/:cid/:aid/export.zip', downloadAuth, async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }
      const db = await getDb();
      const deliverable = await db
        .collection('puc_deliverables')
        .findOne({ course_id: cid, assignment_id: aid });
      if (!deliverable) {
        res.status(404).json({ error: 'entrega_nao_encontrada' });
        return;
      }

      const markdown = String(deliverable.current_markdown || '');
      const assignmentName = String(deliverable.assignment_name || `entrega-${aid}`);
      const fromGithub = await tryFetchFromGithubIfUnchanged(db, deliverable, 'zip');
      const zipBuffer =
        fromGithub || (await generateDeliverableCodeZipBuffer({ assignmentName, markdown }));
      const fileName = `${sanitizeSegment(assignmentName, `entrega-${aid}`)}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err) {
      next(err);
    }
  });

  // Demais rotas exigem autenticação padrão
  r.use(pucAuth);

  // GET /api/puc/assistant/providers
  r.get('/providers', (_req, res) => {
    res.json({
      providers: listConfiguredProviders(),
    });
  });

  // ---- Configuração e Teste do GitHub Privado ----

  // GET /api/puc/assistant/github/config -> status seguro (nunca devolve o token)
  r.get('/github/config', async (_req, res, next) => {
    try {
      const db = await getDb();
      const status = await getGithubConfigStatus(db, new Date(), true);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/assistant/github/test -> valida token, exige repo PRIVADO e escrita
  r.post('/github/test', async (req, res, next) => {
    try {
      const rateKey = req.user?.email || req.ip || 'api-token';
      if (!checkGithubRateLimit(rateKey)) {
        res.status(429).json({ error: 'Muitas requisições ao GitHub. Aguarde alguns minutos.' });
        return;
      }

      const db = await getDb();
      const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      let token = rawToken;
      let owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
      let repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
      let branch = typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'main';

      if (!token) {
        const saved = await getGithubTokenAndConfig(db);
        if (!saved.token || !saved.doc) {
          res.status(400).json({ error: 'Informe um token fine-grained do GitHub para testar.' });
          return;
        }
        token = saved.token;
        if (!owner) owner = saved.doc.owner;
        if (!repo) repo = saved.doc.repo;
        if (!req.body?.branch && saved.doc.branch) branch = saved.doc.branch;
      }

      const result = await testGithubConnection(
        { token, owner, repo, branch },
        {
          onAuthError: rawToken ? undefined : (st) => markGithubAuthError(db, st),
        }
      );
      res.json(result);
    } catch (err) {
      if (err instanceof GithubApiError) {
        const msg =
          err.status === 401
            ? 'Token do GitHub inválido ou expirado (401).'
            : err.status === 403
              ? 'Token sem permissão de acesso/escrita no repositório (403).'
              : err.status === 404
                ? 'Repositório não encontrado ou token sem permissão para vê-lo (404).'
                : err.message;
        res.status(400).json({ error: msg });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // POST /api/puc/assistant/github/config -> valida (repo privado + escrita) e salva criptografado
  r.post('/github/config', async (req, res, next) => {
    try {
      const rateKey = req.user?.email || req.ip || 'api-token';
      if (!checkGithubRateLimit(rateKey)) {
        res.status(429).json({ error: 'Muitas requisições ao GitHub. Aguarde alguns minutos.' });
        return;
      }

      const db = await getDb();
      const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
      const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
      const branch =
        typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'main';
      const autoPublish = Boolean(req.body?.autoPublish);

      let expiresAt: Date | null | undefined = undefined;
      if (req.body?.expiresAt === '' || req.body?.expiresAt === null) {
        expiresAt = null;
      } else if (typeof req.body?.expiresAt === 'string' && req.body.expiresAt.trim()) {
        const parsed = new Date(req.body.expiresAt.trim());
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Data de expiração inválida.' });
          return;
        }
        expiresAt = parsed;
      }

      let tokenToValidate = rawToken;
      if (!tokenToValidate) {
        const saved = await getGithubTokenAndConfig(db);
        if (!saved.token) {
          res.status(400).json({ error: 'Informe um token fine-grained do GitHub.' });
          return;
        }
        tokenToValidate = saved.token;
      }

      // Garante que o repositório existe, é PRIVADO e aceita escrita antes de salvar
      await testGithubConnection({ token: tokenToValidate, owner, repo, branch });

      const status = await saveGithubConfig(db, {
        plainToken: rawToken || undefined,
        owner,
        repo,
        branch,
        autoPublish,
        expiresAt,
      });

      res.json({ ok: true, config: status });
    } catch (err) {
      if (err instanceof GithubApiError || err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // POST /api/puc/assistant/deliverables/:cid/:aid/publish-github -> publica entrega pronta em commit atômico
  r.post('/deliverables/:cid/:aid/publish-github', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const rateKey = req.user?.email || req.ip || 'api-token';
      if (!checkGithubRateLimit(rateKey)) {
        res.status(429).json({ error: 'Limite de publicações no GitHub atingido. Aguarde alguns minutos.' });
        return;
      }

      const db = await getDb();
      const published = await executeGithubPublish(db, cid, aid);
      res.json({ ok: true, ...published });
    } catch (err: any) {
      if (typeof err?.httpStatus === 'number') {
        res.status(err.httpStatus).json({
          error: err.message,
          ...(err.reasons ? { reasons: err.reasons } : {}),
          ...(err.pendingPlaceholders ? { pendingPlaceholders: err.pendingPlaceholders } : {}),
        });
        return;
      }
      if (err instanceof GithubApiError) {
        res.status(err.status === 401 || err.status === 403 ? err.status : 502).json({ error: err.message });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // GET /api/puc/assistant/summary -> entregas aguardando revisão
  r.get('/summary', async (_req, res, next) => {
    try {
      const db = await getDb();
      const awaitingDocs = await db
        .collection('puc_deliverables')
        .find(
          { status: { $in: ['entrega_gerada', 'revisada_por_mim'] } },
          {
            projection: {
              course_id: 1,
              course_name: 1,
              assignment_id: 1,
              assignment_name: 1,
              status: 1,
              updated_at: 1,
              current_markdown: 1,
            },
          }
        )
        .sort({ updated_at: -1 })
        .limit(30)
        .toArray();

      res.json({
        awaitingReviewCount: awaitingDocs.length,
        items: awaitingDocs.map((d) => ({
          courseId: Number(d.course_id),
          courseName: String(d.course_name || ''),
          assignmentId: Number(d.assignment_id),
          assignmentName: String(d.assignment_name || ''),
          status: d.status as DeliverableStatus,
          statusLabel: DELIVERABLE_STATUS_LABEL[(d.status as DeliverableStatus) || 'entrega_gerada'],
          pendingPlaceholdersCount: findPendingPlaceholders(String(d.current_markdown || '')).length,
          updatedAt: d.updated_at ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/puc/assistant/projects?courseId=... -> projetos multi-parte com linha do tempo
  r.get('/projects', async (req, res, next) => {
    try {
      const db = await getDb();
      const filter: Record<string, unknown> = {};
      if (typeof req.query.courseId === 'string' && req.query.courseId.trim()) {
        const cid = parseNumericId(req.query.courseId.trim());
        if (!cid) {
          res.status(400).json({ error: 'course_id_invalido' });
          return;
        }
        filter.course_id = cid;
      }

      const projects = await db
        .collection('puc_projects')
        .find(filter)
        .sort({ course_id: 1, title: 1 })
        .toArray();

      if (projects.length === 0) {
        res.json([]);
        return;
      }

      const courseIds = Array.from(new Set(projects.map((p) => Number(p.course_id))));
      const [assignments, deliverables, courses] = await Promise.all([
        db.collection('canvas_assignments').find({ course_id: { $in: courseIds } }).toArray(),
        db.collection('puc_deliverables').find({ course_id: { $in: courseIds } }).toArray(),
        db.collection('canvas_courses').find({ canvas_id: { $in: courseIds } }).toArray(),
      ]);

      const assignmentByKey = new Map(assignments.map((a) => [`${a.course_id}:${a.canvas_id}`, a]));
      const deliverableByKey = new Map(deliverables.map((d) => [`${d.course_id}:${d.assignment_id}`, d]));
      const courseById = new Map(courses.map((c) => [Number(c.canvas_id), c]));
      const now = new Date();

      const mapped = projects.map((proj) => {
        const course = courseById.get(Number(proj.course_id));
        const aiAllowed = course?.ai_allowed !== false;
        const parts = (Array.isArray(proj.parts) ? proj.parts : []).map((part: any) => {
          const aDoc = assignmentByKey.get(`${proj.course_id}:${part.assignment_id}`) as unknown as AssignmentRecord | undefined;
          const depDoc = part.depends_on
            ? (assignmentByKey.get(`${proj.course_id}:${part.depends_on}`) as unknown as AssignmentRecord | undefined)
            : null;
          const delDoc = deliverableByKey.get(`${proj.course_id}:${part.assignment_id}`);

          const timelineState = aDoc
            ? computePartTimelineState({
                assignment: aDoc,
                dependsOnAssignment: depDoc ?? null,
                deliverableStatus: (delDoc?.status as DeliverableStatus | undefined) ?? null,
                now,
              })
            : 'bloqueada';

          return {
            assignmentId: Number(part.assignment_id),
            name: String(aDoc?.name || part.name || ''),
            order: Number(part.order || 1),
            dependsOn: typeof part.depends_on === 'number' ? part.depends_on : null,
            dueAt: aDoc?.due_at ?? part.due_at ?? null,
            suggestedStartAt: part.suggested_start_at ?? null,
            suggestedReviewAt: part.suggested_review_at ?? null,
            timelineState,
            timelineLabel: PART_TIMELINE_LABEL[timelineState],
            deliverableStatus: (delDoc?.status as DeliverableStatus | undefined) ?? null,
            score: typeof aDoc?.score === 'number' ? aDoc.score : null,
            pointsPossible: typeof aDoc?.points_possible === 'number' ? aDoc.points_possible : null,
            grade: aDoc?.grade ?? null,
            htmlUrl: aDoc?.html_url ?? null,
          };
        });

        return {
          projectId: String(proj.project_id),
          courseId: Number(proj.course_id),
          courseName: String(proj.course_name || course?.name || ''),
          title: String(proj.title || 'Projeto multi-parte'),
          manual: Boolean(proj.manual),
          aiAllowed,
          parts,
        };
      });

      res.json(mapped);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/puc/assistant/courses/:cid/lessons
  r.get('/courses/:cid/lessons', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      if (!cid) {
        res.status(400).json({ error: 'course_id_invalido' });
        return;
      }
      const db = await getDb();
      const doc = await db.collection('puc_course_lessons').findOne({ course_id: cid });
      res.json(
        doc || {
          course_id: cid,
          charged_points: [],
          recurring_issues: [],
          strengths: [],
          raw_notes: [],
          updated_at: null,
        }
      );
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/puc/assistant/assignments/:cid/:aid/classification -> override manual multi_part vs one_shot
  r.patch('/assignments/:cid/:aid/classification', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const kind: AssignmentKind | null =
        req.body?.assignmentKind === 'multi_part' || req.body?.assignmentKind === 'one_shot'
          ? req.body.assignmentKind
          : null;
      if (!kind) {
        res.status(400).json({ error: 'assignment_kind_invalido' });
        return;
      }

      const db = await getDb();
      const [course, target] = await Promise.all([
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
      ]);
      if (!target) {
        res.status(404).json({ error: 'trabalho_nao_encontrado' });
        return;
      }

      const projectId =
        kind === 'multi_part'
          ? typeof req.body?.projectId === 'string' && req.body.projectId.trim()
            ? req.body.projectId.trim().slice(0, 80)
            : `proj-${cid}-manual`
          : null;

      await db.collection('canvas_assignments').updateOne(
        { course_id: cid, canvas_id: aid },
        {
          $set: {
            assignment_kind: kind,
            assignment_kind_manual: true,
            project_id: projectId,
          },
        }
      );

      // Recomputar projetos do curso preservando todos os overrides manuais
      const [allAssignments, existingProjects] = await Promise.all([
        db.collection('canvas_assignments').find({ course_id: cid }).toArray(),
        db.collection('puc_projects').find({ course_id: cid }).toArray(),
      ]);

      const customTitle =
        typeof req.body?.projectTitle === 'string' && req.body.projectTitle.trim()
          ? req.body.projectTitle.trim().slice(0, 120)
          : null;

      const seededProjects = existingProjects.map((p: any) => ({ ...p }));
      if (projectId && customTitle) {
        const idx = seededProjects.findIndex((p: any) => p.project_id === projectId);
        if (idx >= 0) seededProjects[idx].title = customTitle;
        else seededProjects.push({ project_id: projectId, course_id: cid, course_name: String(course?.name || ''), title: customTitle, parts: [] });
      }

      const result = classifyAssignmentsForCourse(
        cid,
        String(course?.name || target.course_name || `Curso ${cid}`),
        allAssignments as unknown as AssignmentRecord[],
        seededProjects as unknown as MultiPartProjectSpec[]
      );

      const now = new Date();
      if (allAssignments.length > 0) {
        await db.collection('canvas_assignments').bulkWrite(
          allAssignments.map((doc: any) => {
            const cls = result.classifications.get(Number(doc.canvas_id));
            return {
              updateOne: {
                filter: { course_id: cid, canvas_id: Number(doc.canvas_id) },
                update: {
                  $set: {
                    assignment_kind: cls?.assignment_kind ?? 'one_shot',
                    project_id: cls?.project_id ?? null,
                    part_order: cls?.part_order ?? null,
                    depends_on: cls?.depends_on ?? null,
                  },
                },
              },
            };
          })
        );
      }

      const activeProjectIds = result.projects.map((p) => p.project_id);
      if (result.projects.length > 0) {
        await db.collection('puc_projects').bulkWrite(
          result.projects.map((proj) => ({
            updateOne: {
              filter: { course_id: cid, project_id: proj.project_id },
              update: {
                $set: {
                  course_id: cid,
                  course_name: proj.course_name,
                  project_id: proj.project_id,
                  title: proj.title,
                  manual: Boolean(proj.manual),
                  parts: proj.parts,
                  updated_at: now,
                },
                $setOnInsert: { created_at: now },
              },
              upsert: true,
            },
          }))
        );
      }
      await db.collection('puc_projects').deleteMany({ course_id: cid, project_id: { $nin: activeProjectIds } });

      const updatedCls = result.classifications.get(aid);
      res.json({
        ok: true,
        assignmentKind: updatedCls?.assignment_kind ?? kind,
        projectId: updatedCls?.project_id ?? null,
        partOrder: updatedCls?.part_order ?? null,
        dependsOn: updatedCls?.depends_on ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/puc/assistant/deliverables/:cid/:aid -> carrega workspace completo da entrega
  r.get('/deliverables/:cid/:aid', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const db = await getDb();
      const [assignment, course, deliverable, lessons, tokenDoc, githubStatus] = await Promise.all([
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
        db.collection('puc_course_lessons').findOne({ course_id: cid }),
        db.collection('canvas_auth').findOne({ _id: 'puc' as any }),
        getGithubConfigStatus(db),
      ]);

      if (!assignment) {
        res.status(404).json({ error: 'trabalho_nao_encontrado' });
        return;
      }

      const assignmentKind: AssignmentKind =
        assignment.assignment_kind === 'multi_part' ? 'multi_part' : 'one_shot';
      const now = new Date();

      let projectPayload: any = null;
      let canGenerateCheck = { allowed: true, state: 'liberada' as string, reason: undefined as string | undefined };

      if (assignmentKind === 'multi_part' && assignment.project_id) {
        const proj = await db
          .collection('puc_projects')
          .findOne({ course_id: cid, project_id: assignment.project_id });
        if (proj) {
          const [projAssignments, projDeliverables] = await Promise.all([
            db.collection('canvas_assignments').find({ course_id: cid }).toArray(),
            db.collection('puc_deliverables').find({ course_id: cid }).toArray(),
          ]);
          const aMap = new Map(projAssignments.map((a) => [Number(a.canvas_id), a]));
          const dMap = new Map(projDeliverables.map((d) => [Number(d.assignment_id), d]));

          const parts = (Array.isArray(proj.parts) ? proj.parts : []).map((part: any) => {
            const pDoc = aMap.get(Number(part.assignment_id)) as unknown as AssignmentRecord | undefined;
            const depDoc = part.depends_on
              ? (aMap.get(Number(part.depends_on)) as unknown as AssignmentRecord | undefined)
              : null;
            const pDel = dMap.get(Number(part.assignment_id));
            const st = pDoc
              ? computePartTimelineState({
                  assignment: pDoc,
                  dependsOnAssignment: depDoc ?? null,
                  deliverableStatus: (pDel?.status as DeliverableStatus | undefined) ?? null,
                  now,
                })
              : 'bloqueada';

            return {
              assignmentId: Number(part.assignment_id),
              name: String(pDoc?.name || part.name || ''),
              order: Number(part.order || 1),
              dependsOn: typeof part.depends_on === 'number' ? part.depends_on : null,
              dueAt: pDoc?.due_at ?? part.due_at ?? null,
              suggestedStartAt: part.suggested_start_at ?? null,
              suggestedReviewAt: part.suggested_review_at ?? null,
              timelineState: st,
              timelineLabel: PART_TIMELINE_LABEL[st],
              deliverableStatus: (pDel?.status as DeliverableStatus | undefined) ?? null,
              score: typeof pDoc?.score === 'number' ? pDoc.score : null,
              pointsPossible: typeof pDoc?.points_possible === 'number' ? pDoc.points_possible : null,
              grade: pDoc?.grade ?? null,
              htmlUrl: pDoc?.html_url ?? null,
            };
          });

          const thisPart = parts.find((p: any) => p.assignmentId === aid);
          const depDoc = thisPart?.dependsOn
            ? (aMap.get(thisPart.dependsOn) as unknown as AssignmentRecord | undefined)
            : null;
          canGenerateCheck = canGenerateForPart({
            assignment: assignment as unknown as AssignmentRecord,
            dependsOnAssignment: depDoc ?? null,
            deliverableStatus: (deliverable?.status as DeliverableStatus | undefined) ?? null,
            now,
          }) as any;

          projectPayload = {
            projectId: String(proj.project_id),
            title: String(proj.title || 'Projeto multi-parte'),
            manual: Boolean(proj.manual),
            parts,
          };
        }
      }

      const currentMarkdown = String(deliverable?.current_markdown || '');
      const exportGate = deliverable
        ? canExportDeliverable(deliverable.status, currentMarkdown)
        : { allowed: false, reasons: ['Gere a entrega primeiro.'], pendingPlaceholders: [] };
      const codeFiles = currentMarkdown ? extractCodeFilesFromMarkdown(currentMarkdown) : [];

      res.json({
        course: {
          id: cid,
          name: String(course?.name || assignment.course_name || ''),
          aiAllowed: course?.ai_allowed !== false,
          groupMembers: Array.isArray(course?.group_members) ? course.group_members : [],
        },
        studentName: String(
          deliverable?.student_name || tokenDoc?.canvas_user_name || ''
        ),
        assignment: {
          id: aid,
          courseId: cid,
          name: String(assignment.name || ''),
          description: assignment.description ?? null,
          dueAt: assignment.due_at ?? null,
          pointsPossible: assignment.points_possible ?? null,
          submissionTypes: Array.isArray(assignment.submission_types) ? assignment.submission_types : [],
          htmlUrl: assignment.html_url ?? null,
          score: typeof assignment.score === 'number' ? assignment.score : null,
          grade: assignment.grade ?? null,
          rubric: Array.isArray(assignment.rubric) ? assignment.rubric : [],
          submissionComments: Array.isArray(assignment.submission_comments)
            ? assignment.submission_comments
            : [],
          assignmentKind,
          assignmentKindManual: Boolean(assignment.assignment_kind_manual),
          projectId: assignment.project_id ?? null,
        },
        project: projectPayload,
        canGenerate: course?.ai_allowed !== false && canGenerateCheck.allowed,
        generateBlockedReason:
          course?.ai_allowed === false
            ? 'IA desabilitada para este curso.'
            : canGenerateCheck.reason || null,
        lessons: lessons || null,
        deliverable: deliverable
          ? {
              status: deliverable.status as DeliverableStatus,
              statusLabel:
                DELIVERABLE_STATUS_LABEL[(deliverable.status as DeliverableStatus) || 'entrega_gerada'],
              currentMarkdown,
              groupMembers: Array.isArray(deliverable.group_members)
                ? deliverable.group_members
                : Array.isArray(course?.group_members)
                  ? course.group_members
                  : [],
              versions: Array.isArray(deliverable.versions) ? deliverable.versions : [],
              publications: Array.isArray(deliverable.publications) ? deliverable.publications : [],
              lastPublishedUrl: deliverable.last_published_url ?? null,
              lastPublishedFolderUrl: deliverable.last_published_folder_url ?? null,
              lastPublishedVersion: deliverable.last_published_version ?? null,
              lastPublishedAt: deliverable.last_published_at ?? null,
              hasUnpublishedChanges: Boolean(
                deliverable.last_published_hash &&
                  deliverable.last_published_hash !== sha256Text(currentMarkdown)
              ),
              lastReview: deliverable.last_review ?? null,
              hasCodeFiles: codeFiles.length > 0,
              codeFilesCount: codeFiles.length,
              exportGate,
              updatedAt: deliverable.updated_at ?? null,
            }
          : null,
        github: githubStatus,
        providers: listConfiguredProviders(),
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/assistant/deliverables/:cid/:aid/generate -> gera a ENTREGA PRONTA
  r.post('/deliverables/:cid/:aid/generate', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const rateKey = req.user?.email || req.ip || 'api-token';
      if (!checkAiGenRateLimit(rateKey)) {
        res.status(429).json({ error: 'Limite de gerações atingido. Aguarde alguns minutos e tente novamente.' });
        return;
      }

      const db = await getDb();
      const [course, assignment, lessons, tokenAuth, existingDeliverable] = await Promise.all([
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
        db.collection('puc_course_lessons').findOne({ course_id: cid }),
        getCanvasToken(db),
        db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
      ]);

      if (!assignment) {
        res.status(404).json({ error: 'trabalho_nao_encontrado' });
        return;
      }
      if (course?.ai_allowed === false) {
        res.status(403).json({ error: 'IA desativada para este curso. Ative "IA permitida" para gerar entregas.' });
        return;
      }

      const now = new Date();
      let previousPartApproved: PreviousPartApprovedInput | null = null;

      // Gate rígido de dependência para projetos multi-parte
      if (assignment.assignment_kind === 'multi_part' && typeof assignment.depends_on === 'number') {
        const depDoc = (await db.collection('canvas_assignments').findOne({
          course_id: cid,
          canvas_id: assignment.depends_on,
        })) as unknown as AssignmentRecord | null;

        const gate = canGenerateForPart({
          assignment: assignment as unknown as AssignmentRecord,
          dependsOnAssignment: depDoc,
          deliverableStatus: (existingDeliverable?.status as DeliverableStatus | undefined) ?? null,
          now,
        });
        if (!gate.allowed) {
          res.status(409).json({ error: gate.reason || 'Parte anterior ainda não corrigida no Canvas.' });
          return;
        }

        if (depDoc) {
          const prevDel = await db
            .collection('puc_deliverables')
            .findOne({ course_id: cid, assignment_id: depDoc.canvas_id });
          previousPartApproved = {
            assignment_id: depDoc.canvas_id,
            name: depDoc.name,
            approved_markdown:
              (typeof prevDel?.current_markdown === 'string' && prevDel.current_markdown) ||
              sanitizeHtmlToText(depDoc.submission_body, 6000) ||
              null,
            score: depDoc.score ?? null,
            points_possible: depDoc.points_possible ?? null,
            grade: depDoc.grade ?? null,
            comments: depDoc.submission_comments ?? [],
            rubric_assessment: depDoc.rubric_assessment ?? null,
          };
        }
      }

      // Buscar materiais relevantes do curso + entregas anteriores
      const [coursePages, courseFiles, otherAssignments] = await Promise.all([
        db.collection('canvas_pages').find({ course_id: cid }).limit(40).toArray(),
        db.collection('canvas_files').find({ course_id: cid }).limit(60).toArray(),
        db
          .collection('canvas_assignments')
          .find({
            course_id: cid,
            canvas_id: { $ne: aid },
            $or: [{ workflow_state: 'graded' }, { submitted_at: { $ne: null } }],
          })
          .sort({ submitted_at: -1, due_at: -1 })
          .limit(5)
          .toArray(),
      ]);

      const onUnauthorized = async () => {
        await markCanvasToken401(db);
      };

      // Extrair anexos legíveis do trabalho atual (se houver e se o token Canvas estiver disponível)
      const assignmentAttachments: ExtractedAttachmentText[] = [];
      if (tokenAuth.token && Array.isArray(assignment.attachments)) {
        for (const att of assignment.attachments.slice(0, 3)) {
          if (typeof att?.id !== 'number') continue;
          const extracted = await downloadAndExtractCanvasAttachment(
            att.id,
            String(att.display_name || 'anexo'),
            String(att.content_type || 'application/octet-stream'),
            tokenAuth.token,
            onUnauthorized
          );
          if (extracted) assignmentAttachments.push(extracted);
        }
      }

      // Montar entregas anteriores do usuário (texto + anexos frescos)
      const previousSubmissions: PreviousSubmissionInput[] = [];
      for (const prev of otherAssignments.slice(0, 3)) {
        const prevAtts: ExtractedAttachmentText[] = [];
        if (tokenAuth.token && Array.isArray(prev.attachments)) {
          for (const att of prev.attachments.slice(0, 1)) {
            if (typeof att?.id !== 'number') continue;
            const extracted = await downloadAndExtractCanvasAttachment(
              att.id,
              String(att.display_name || 'anexo'),
              String(att.content_type || 'application/octet-stream'),
              tokenAuth.token,
              onUnauthorized
            );
            if (extracted) prevAtts.push(extracted);
          }
        }
        previousSubmissions.push({
          assignment_id: Number(prev.canvas_id),
          name: String(prev.name || ''),
          score: typeof prev.score === 'number' ? prev.score : null,
          points_possible: typeof prev.points_possible === 'number' ? prev.points_possible : null,
          grade: prev.grade ?? null,
          submitted_text: typeof prev.submission_body === 'string' ? prev.submission_body : null,
          attachments_text: prevAtts,
          comments: Array.isArray(prev.submission_comments) ? prev.submission_comments : [],
          rubric_assessment: prev.rubric_assessment ?? null,
          rubric: Array.isArray(prev.rubric) ? prev.rubric : [],
        });
      }

      const groupMembers =
        Array.isArray(req.body?.groupMembers) && req.body.groupMembers.length > 0
          ? cleanGroupMembers(req.body.groupMembers)
          : Array.isArray(existingDeliverable?.group_members) && existingDeliverable.group_members.length > 0
            ? existingDeliverable.group_members
            : Array.isArray(course?.group_members)
              ? course.group_members
              : [];

      const studentName = String(
        req.body?.studentName || existingDeliverable?.student_name || tokenAuth.doc?.canvas_user_name || ''
      ).trim();

      const builtContext = buildDeliverableContext({
        courseName: String(course?.name || assignment.course_name || ''),
        assignment: assignment as unknown as AssignmentRecord,
        assignmentAttachments,
        coursePages: coursePages.map((p) => ({
          title: String(p.title || ''),
          body: typeof p.body === 'string' ? p.body : '',
          html_url: p.html_url ?? null,
        })),
        courseFiles: courseFiles.map((f) => ({
          display_name: String(f.display_name || f.filename || ''),
          origin_path: String(f.origin_path || 'Raiz'),
        })),
        previousSubmissions,
        previousPartApproved,
        teacherLessons: (lessons as unknown as CourseLessonSummary) ?? null,
        groupMembers,
        studentName: studentName || null,
      });

      const preferredProvider = parseProvider(req.body?.provider);
      const customInstructions =
        typeof req.body?.instructions === 'string' ? req.body.instructions.trim().slice(0, 1500) : '';

      const generated = await generateDeliverable({
        context: builtContext,
        preferredProvider,
        customInstructions,
      });

      const prevVersions = Array.isArray(existingDeliverable?.versions) ? existingDeliverable.versions : [];
      const versionNumber = prevVersions.length + 1;
      const newVersion = {
        version: versionNumber,
        createdAt: now.toISOString(),
        provider: generated.provider,
        providerLabel: generated.providerLabel,
        model: generated.model,
        source: 'ai_generation',
        markdown: generated.text,
      };
      const updatedVersions = [...prevVersions, newVersion].slice(-15);

      await db.collection('puc_deliverables').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            course_id: cid,
            course_name: String(course?.name || assignment.course_name || ''),
            assignment_id: aid,
            assignment_name: String(assignment.name || ''),
            status: 'entrega_gerada' as DeliverableStatus,
            current_markdown: generated.text,
            student_name: studentName,
            group_members: groupMembers,
            last_provider: generated.provider,
            last_model: generated.model,
            versions: updatedVersions,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
          },
        },
        { upsert: true }
      );

      const exportGate = canExportDeliverable('entrega_gerada', generated.text);
      const codeFiles = extractCodeFilesFromMarkdown(generated.text);

      res.json({
        ok: true,
        status: 'entrega_gerada' as DeliverableStatus,
        statusLabel: DELIVERABLE_STATUS_LABEL.entrega_gerada,
        currentMarkdown: generated.text,
        provider: generated.provider,
        providerLabel: generated.providerLabel,
        model: generated.model,
        versions: updatedVersions,
        hasCodeFiles: codeFiles.length > 0,
        codeFilesCount: codeFiles.length,
        exportGate,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao gerar entrega.';
      if (msg.includes('Nenhum provedor de IA configurado')) {
        res.status(503).json({ error: msg });
        return;
      }
      next(err);
    }
  });

  // PATCH /api/puc/assistant/deliverables/:cid/:aid -> salva edição, status e integrantes do grupo
  r.patch('/deliverables/:cid/:aid', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const db = await getDb();
      const [existing, assignment, course] = await Promise.all([
        db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
      ]);

      if (!assignment) {
        res.status(404).json({ error: 'trabalho_nao_encontrado' });
        return;
      }

      const now = new Date();
      const nextMarkdown =
        typeof req.body?.markdown === 'string'
          ? req.body.markdown
          : String(existing?.current_markdown || '');

      let nextStatus: DeliverableStatus =
        parseStatus(req.body?.status) ||
        (existing?.status as DeliverableStatus) ||
        'revisada_por_mim';

      // Não permitir marcar como 'pronta' se ainda houver [PREENCHER] pendente
      const pendingPlaceholders = findPendingPlaceholders(nextMarkdown);
      if (nextStatus === 'pronta' && pendingPlaceholders.length > 0) {
        res.status(400).json({
          error: `Complete os ${pendingPlaceholders.length} marcador(es) [PREENCHER] antes de marcar a entrega como pronta.`,
          pendingPlaceholders,
        });
        return;
      }

      const patch: Record<string, unknown> = {
        course_id: cid,
        course_name: String(course?.name || assignment.course_name || ''),
        assignment_id: aid,
        assignment_name: String(assignment.name || ''),
        current_markdown: nextMarkdown,
        content_hash: sha256Text(nextMarkdown),
        status: nextStatus,
        updated_at: now,
      };

      if (req.body?.groupMembers !== undefined) {
        patch.group_members = cleanGroupMembers(req.body.groupMembers);
      }
      if (typeof req.body?.studentName === 'string') {
        patch.student_name = req.body.studentName.trim().slice(0, 100);
      }

      let versions = Array.isArray(existing?.versions) ? existing.versions : [];
      if (req.body?.saveVersion === true && nextMarkdown.trim()) {
        versions = [
          ...versions,
          {
            version: versions.length + 1,
            createdAt: now.toISOString(),
            provider: 'manual',
            providerLabel: 'Edição manual',
            model: 'usuario',
            source: 'manual_edit',
            markdown: nextMarkdown,
          },
        ].slice(-15);
        patch.versions = versions;
      }

      await db.collection('puc_deliverables').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: patch,
          $setOnInsert: { created_at: now },
        },
        { upsert: true }
      );

      const exportGate = canExportDeliverable(nextStatus, nextMarkdown);
      const codeFiles = extractCodeFilesFromMarkdown(nextMarkdown);

      // Publicação automática no GitHub ao marcar como "pronta" (se habilitada na tela GitHub)
      let githubPublication: any = null;
      let githubWarning: string | null = null;
      if (nextStatus === 'pronta' && exportGate.allowed) {
        const ghStatus = await getGithubConfigStatus(db);
        const alreadySameHash = existing?.last_published_hash === sha256Text(nextMarkdown);
        if (ghStatus.configured && ghStatus.autoPublish && !ghStatus.expired && !alreadySameHash) {
          try {
            const pubRes = await executeGithubPublish(db, cid, aid);
            githubPublication = pubRes.publication;
            versions = [];
          } catch (pubErr) {
            githubWarning =
              pubErr instanceof Error ? pubErr.message : 'Falha ao publicar automaticamente no GitHub.';
          }
        }
      }

      res.json({
        ok: true,
        status: nextStatus,
        statusLabel: DELIVERABLE_STATUS_LABEL[nextStatus],
        currentMarkdown: nextMarkdown,
        groupMembers: patch.group_members ?? existing?.group_members ?? [],
        versions,
        githubPublication,
        githubWarning,
        hasCodeFiles: codeFiles.length > 0,
        codeFilesCount: codeFiles.length,
        exportGate,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/assistant/deliverables/:cid/:aid/review -> Revisar com IA (2º passe por outro provedor)
  r.post('/deliverables/:cid/:aid/review', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const rateKey = req.user?.email || req.ip || 'api-token';
      if (!checkAiGenRateLimit(rateKey)) {
        res.status(429).json({ error: 'Limite de revisões atingido. Aguarde alguns minutos.' });
        return;
      }

      const db = await getDb();
      const [course, assignment, deliverable, lessons] = await Promise.all([
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
        db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
        db.collection('puc_course_lessons').findOne({ course_id: cid }),
      ]);

      if (!assignment) {
        res.status(404).json({ error: 'trabalho_nao_encontrado' });
        return;
      }
      if (course?.ai_allowed === false) {
        res.status(403).json({ error: 'IA desativada para este curso.' });
        return;
      }

      const markdown =
        typeof req.body?.markdown === 'string' && req.body.markdown.trim()
          ? req.body.markdown
          : String(deliverable?.current_markdown || '');

      if (!markdown.trim()) {
        res.status(400).json({ error: 'Gere ou escreva a entrega antes de solicitar revisão com IA.' });
        return;
      }

      const preferredProvider = parseProvider(req.body?.provider);
      const excludeProvider =
        preferredProvider === 'auto' &&
        (deliverable?.last_provider === 'gemini' ||
          deliverable?.last_provider === 'groq' ||
          deliverable?.last_provider === 'openrouter')
          ? (deliverable.last_provider as ConcreteProviderId)
          : undefined;

      const review = await reviewDeliverable({
        deliverableMarkdown: markdown,
        assignmentName: String(assignment.name || ''),
        assignmentDescription: sanitizeHtmlToText(assignment.description, 5000),
        rubric: Array.isArray(assignment.rubric) ? assignment.rubric : [],
        teacherLessons: (lessons as unknown as CourseLessonSummary) ?? null,
        preferredProvider,
        excludeProvider,
      });

      const now = new Date();
      const reviewRecord = {
        ...review,
        reviewedAt: now.toISOString(),
      };

      await db.collection('puc_deliverables').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            last_review: reviewRecord,
            updated_at: now,
          },
        }
      );

      res.json({ ok: true, review: reviewRecord });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao revisar entrega com IA.';
      if (msg.includes('Nenhum provedor de IA configurado')) {
        res.status(503).json({ error: msg });
        return;
      }
      next(err);
    }
  });

  return r;
}
