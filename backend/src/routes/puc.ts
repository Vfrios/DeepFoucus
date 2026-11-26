import { NextFunction, Request, Response, Router } from 'express';
import { askCanvasAI } from '../lib/canvasAi';
import { CanvasApiError, validateCanvasToken } from '../lib/canvasApi';
import { getCanvasTokenStatus, saveCanvasToken } from '../lib/canvasAuth';
import {
  CanvasSyncMode,
  getCanvasSyncProgress,
  isCanvasSyncRunning,
  syncAgora,
} from '../lib/canvasSync';
import { classifyDeliveryStatus, saoPauloDayBounds } from '../lib/canvasUtils';
import { getDb } from '../lib/mongo';
import { apiTokenAuth } from '../middleware/apiToken';
import { jwtAuth } from '../middleware/jwtAuth';
import { requireRole } from '../middleware/requireRole';
import { createPucDownloadRouter } from './pucDownload';
import { createPucAssistantRouter } from './pucAssistant';
import { createPucAgentRouter } from './pucAgent';
import {
  findPendingPlaceholders,
  isReadyToSubmitInCanvas,
  normalizeDeliverableStatus,
} from '../lib/pucAssistantCore';

const r = Router();

// Rate limit simples em memória para /ask (15 perguntas por minuto por usuário/IP)
const ASK_WINDOW_MS = 60_000;
const ASK_MAX_REQUESTS = 15;
const askHits = new Map<string, number[]>();

function checkAskRateLimit(key: string): boolean {
  const now = Date.now();
  const prev = (askHits.get(key) || []).filter((ts) => now - ts < ASK_WINDOW_MS);
  if (prev.length >= ASK_MAX_REQUESTS) {
    askHits.set(key, prev);
    return false;
  }
  prev.push(now);
  askHits.set(key, prev);
  if (askHits.size > 200) {
    for (const [k, v] of askHits.entries()) {
      if (v.every((ts) => now - ts >= ASK_WINDOW_MS)) askHits.delete(k);
    }
  }
  return true;
}

/**
 * Protege todas as rotas PUC:
 * - Aceita `x-api-token` (API_TOKEN) para scripts/Atalhos/curl.
 * - Aceita `Authorization: Bearer <JWT>` com role `owner` para a interface React.
 */
function pucAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.header('x-api-token')) {
    apiTokenAuth(req, res, next);
    return;
  }
  jwtAuth(req, res, () => requireRole(['owner'])(req, res, next));
}

function parseNumericId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function isValidSlug(raw: string): boolean {
  return raw.length > 0 && raw.length <= 200 && /^[a-zA-Z0-9._~%-]+$/.test(raw) && !raw.includes('..');
}

function mapAssignment(a: any, now: Date, deliverable?: any) {
  const deliveryStatus = classifyDeliveryStatus(a, now);
  const deliverableStatus = deliverable?.status ? normalizeDeliverableStatus(deliverable.status) : null;
  const readyToSubmit = isReadyToSubmitInCanvas(deliverableStatus, deliveryStatus);
  return {
    id: Number(a.canvas_id),
    courseId: Number(a.course_id),
    courseName: String(a.course_name || ''),
    name: String(a.name || ''),
    description: a.description ?? null,
    dueAt: a.due_at ?? null,
    lockAt: a.lock_at ?? null,
    lockedForUser: Boolean(a.locked_for_user),
    pointsPossible: a.points_possible ?? null,
    htmlUrl: a.html_url ?? null,
    submissionTypes: Array.isArray(a.submission_types) ? a.submission_types : [],
    workflowState: a.workflow_state ?? 'unsubmitted',
    submittedAt: a.submitted_at ?? null,
    score: typeof a.score === 'number' ? a.score : null,
    grade: a.grade ?? null,
    late: Boolean(a.late),
    missing: Boolean(a.missing),
    excused: Boolean(a.excused),
    deliveryStatus,
    attachments: Array.isArray(a.attachments) ? a.attachments : [],
    rubric: Array.isArray(a.rubric) ? a.rubric : [],
    assignmentKind: a.assignment_kind === 'multi_part' ? 'multi_part' : 'one_shot',
    assignmentKindManual: Boolean(a.assignment_kind_manual),
    projectId: a.project_id ?? null,
    partOrder: typeof a.part_order === 'number' ? a.part_order : null,
    dependsOn: typeof a.depends_on === 'number' ? a.depends_on : null,
    deliverableStatus,
    readyToSubmit,
    isHandwritten: Boolean(deliverable?.is_handwritten),
    githubUrl: deliverable?.last_published_url ?? deliverable?.pending_html_url ?? null,
    hasPendingGithub:
      Array.isArray(deliverable?.pending_github_paths) && deliverable.pending_github_paths.length > 0,
    statementChanged: Boolean(deliverable?.statement_changed),
    pendingPlaceholdersCount: deliverable?.current_markdown
      ? findPendingPlaceholders(String(deliverable.current_markdown)).length
      : 0,
  };
}

// Monta as rotas de download, do assistente e do agente antes do middleware global
r.use(createPucDownloadRouter(pucAuth));
r.use('/assistant', createPucAssistantRouter(pucAuth));
r.use('/agent', createPucAgentRouter(pucAuth));

// Demais rotas exigem autenticação padrão
r.use(pucAuth);

// GET /api/puc/status -> status do token, progresso do sync, último sync e contadores globais
r.get('/status', async (_req, res, next) => {
  try {
    const db = await getDb();
    const now = new Date();
    const [tokenStatus, lastSync, visibleCourses] = await Promise.all([
      getCanvasTokenStatus(db, now),
      db.collection('canvas_sync_log').find().sort({ started_at: -1 }).limit(1).next(),
      db
        .collection('canvas_courses')
        .find({ active: true, hidden: { $ne: true }, has_grades: true }, { projection: { canvas_id: 1 } })
        .toArray(),
    ]);

    const visibleIds = visibleCourses.map((c) => Number(c.canvas_id));
    const { todayStart, todayEnd, weekEnd } = saoPauloDayBounds(now);

    let pending = 0;
    let overdue = 0;
    let submitted = 0;
    let graded = 0;
    let dueToday = 0;
    let dueThisWeek = 0;
    let unreadAnnouncements = 0;
    let readyToSubmit = 0;
    const awaitingReview = await db
      .collection('puc_deliverables')
      .countDocuments({
        status: { $in: ['rascunho', 'enviado_a_verificar', 'revisada_por_mim', 'validada', 'pronta'] },
      });

    if (visibleIds.length > 0) {
      const [allAssignments, unreadCount, generatedDeliverables] = await Promise.all([
        db
          .collection('canvas_assignments')
          .find(
            { course_id: { $in: visibleIds } },
            {
              projection: {
                course_id: 1,
                canvas_id: 1,
                due_at: 1,
                locked_for_user: 1,
                points_possible: 1,
                submission_types: 1,
                workflow_state: 1,
                submitted_at: 1,
                score: 1,
                grade: 1,
                late: 1,
                missing: 1,
                excused: 1,
              },
            }
          )
          .toArray(),
        db
          .collection('canvas_announcements')
          .countDocuments({ course_id: { $in: visibleIds }, read: { $ne: true } }),
        db
          .collection('puc_deliverables')
          .find(
            { course_id: { $in: visibleIds }, status: 'entrega_gerada' },
            { projection: { course_id: 1, assignment_id: 1, status: 1 } }
          )
          .toArray(),
      ]);

      unreadAnnouncements = unreadCount;
      const generatedKeySet = new Set(
        generatedDeliverables.map((d) => `${d.course_id}:${d.assignment_id}`)
      );

      for (const a of allAssignments) {
        const st = classifyDeliveryStatus(a as any, now);
        if (st === 'pendente') pending += 1;
        else if (st === 'atrasado') overdue += 1;
        else if (st === 'entregue') submitted += 1;
        else if (st === 'corrigido') graded += 1;

        // "Entrega gerada" continua contando em pending/overdue até o sync detectar 'entregue' no Canvas,
        // e entra no contador "Prontas para enviar: N"
        if (generatedKeySet.has(`${a.course_id}:${a.canvas_id}`) && isReadyToSubmitInCanvas('entrega_gerada', st)) {
          readyToSubmit += 1;
        }

        if ((st === 'pendente' || st === 'atrasado') && a.due_at) {
          const dueMs = new Date(a.due_at).getTime();
          if (dueMs >= todayStart.getTime() && dueMs <= todayEnd.getTime()) dueToday += 1;
          if (dueMs >= todayStart.getTime() && dueMs <= weekEnd.getTime()) dueThisWeek += 1;
        }
      }
    }

    res.json({
      token: tokenStatus,
      syncing: isCanvasSyncRunning(),
      progress: getCanvasSyncProgress(),
      summary: {
        pending,
        overdue,
        submitted,
        graded,
        dueToday,
        dueThisWeek,
        unreadAnnouncements,
        awaitingReview,
        readyToSubmit,
      },
      lastSync: lastSync
        ? {
            startedAt: lastSync.started_at,
            finishedAt: lastSync.finished_at,
            durationMs: lastSync.duration_ms ?? null,
            mode: lastSync.mode || 'full',
            status: lastSync.status,
            coursesDiscovered: lastSync.courses_discovered ?? null,
            coursesSynced: lastSync.courses_synced ?? null,
            coursesHidden: lastSync.courses_hidden ?? null,
            timingsMs: lastSync.timings_ms ?? null,
            error: lastSync.error ?? null,
            warningsCount: Array.isArray(lastSync.warnings) ? lastSync.warnings.length : 0,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/puc/token -> valida no Canvas (GET /api/v1/users/self) e salva criptografado
r.post('/token', async (req, res, next) => {
  try {
    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!rawToken || rawToken.length < 10 || rawToken.length > 500) {
      res.status(400).json({ error: 'Informe um token de acesso válido do Canvas.' });
      return;
    }

    let userInfo: { id?: number; name?: string };
    try {
      const user = await validateCanvasToken(rawToken);
      userInfo = { id: user.id, name: user.name || user.short_name };
    } catch (err) {
      if (err instanceof CanvasApiError) {
        const msg =
          err.status === 401
            ? 'Token rejeitado pelo Canvas (401). Verifique se copiou o token corretamente e se ele está ativo.'
            : `Canvas retornou HTTP ${err.status} ao validar o token.`;
        res.status(400).json({ error: msg });
        return;
      }
      res.status(502).json({ error: 'Não foi possível conectar ao Canvas para validar o token.' });
      return;
    }

    const db = await getDb();
    let status;
    try {
      status = await saveCanvasToken(db, rawToken, userInfo);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao criptografar e salvar o token.',
      });
      return;
    }

    res.status(200).json({ ok: true, token: status });
  } catch (err) {
    next(err);
  }
});

// POST /api/puc/sync -> dispara sincronização leve (padrão) ou completa ({ mode: 'full' })
r.post('/sync', async (req, res, next) => {
  try {
    const mode: CanvasSyncMode = req.body?.mode === 'full' ? 'full' : 'light';
    const db = await getDb();
    const result = await syncAgora(db, mode);
    if (result.skipped && result.reason === 'sync_already_running') {
      res.status(409).json(result);
      return;
    }
    if (result.skipped && result.reason === 'token_not_configured') {
      res.status(400).json({ ...result, error: 'Configure o token do Canvas antes de sincronizar.' });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/puc/ask -> modo IA em linguagem natural com tool calling somente leitura
r.post('/ask', async (req, res, next) => {
  try {
    const rateKey = req.user?.email || req.ip || 'api-token';
    if (!checkAskRateLimit(rateKey)) {
      res.status(429).json({ error: 'Muitas perguntas em seguida. Aguarde um minuto e tente novamente.' });
      return;
    }

    const rawQuestion = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!rawQuestion) {
      res.status(400).json({ error: 'Digite uma pergunta.' });
      return;
    }
    if (rawQuestion.length > 400) {
      res.status(400).json({ error: 'A pergunta deve ter no máximo 400 caracteres.' });
      return;
    }

    const db = await getDb();
    const result = await askCanvasAI(db, rawQuestion);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao consultar o assistente.';
    if (msg.includes('LLM_API_KEY')) {
      res.status(503).json({ error: msg });
      return;
    }
    next(err);
  }
});

// GET /api/puc/courses -> lista apenas cursos/salas que possuem notas/entregas avaliativas
r.get('/courses', async (_req, res, next) => {
  try {
    const db = await getDb();
    const courses = await db
      .collection('canvas_courses')
      .find({ active: true, has_grades: true })
      .sort({ term_start_at: -1, term_name: -1, name: 1 })
      .toArray();

    res.json(
      courses.map((c) => ({
        id: Number(c.canvas_id),
        name: String(c.name || ''),
        courseCode: String(c.course_code || ''),
        termId: c.term_id ?? null,
        termName: String(c.term_name || 'Sem semestre'),
        termStartAt: c.term_start_at ?? null,
        hidden: Boolean(c.hidden),
        aiAllowed: c.ai_allowed !== false,
        myProject: typeof c.my_project === 'string' ? c.my_project : '',
        groupMembers: Array.isArray(c.group_members) ? c.group_members : [],
        aliases: Array.isArray(c.aliases) ? c.aliases : [],
        autoAliases: Array.isArray(c.auto_aliases) ? c.auto_aliases : [],
        filesCount: Number(c.files_count || 0),
        assignmentsCount: Number(c.assignments_count || 0),
        announcementsCount: Number(c.announcements_count || 0),
        pagesCount: Number(c.pages_count || 0),
        lastSyncedAt: c.last_synced_at ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/puc/courses/:cid -> atualiza toggle "hidden" e/ou "aliases"
r.patch('/courses/:cid', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    if (!cid) {
      res.status(400).json({ error: 'course_id_invalido' });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (typeof req.body?.hidden === 'boolean') {
      patch.hidden = req.body.hidden;
    }
    if (typeof req.body?.aiAllowed === 'boolean') {
      patch.ai_allowed = req.body.aiAllowed;
    }
    if (typeof req.body?.myProject === 'string') {
      patch.my_project = req.body.myProject.trim().slice(0, 6000);
    }
    if (Array.isArray(req.body?.aliases)) {
      const cleaned = Array.from(
        new Set(
          req.body.aliases
            .filter((item: unknown): item is string => typeof item === 'string')
            .map((s: string) => s.trim().slice(0, 30))
            .filter((s: string) => s.length > 0)
        )
      ).slice(0, 10);
      patch.aliases = cleaned;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'nenhum_campo_valido_enviado' });
      return;
    }

    const db = await getDb();
    const result = await db
      .collection('canvas_courses')
      .findOneAndUpdate({ canvas_id: cid }, { $set: patch }, { returnDocument: 'after' });

    if (!result) {
      res.status(404).json({ error: 'curso_nao_encontrado' });
      return;
    }

    res.json({
      id: Number(result.canvas_id),
      hidden: Boolean(result.hidden),
      aiAllowed: result.ai_allowed !== false,
      myProject: typeof result.my_project === 'string' ? result.my_project : '',
      aliases: Array.isArray(result.aliases) ? result.aliases : [],
      autoAliases: Array.isArray(result.auto_aliases) ? result.auto_aliases : [],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/upcoming -> SOMENTE pendentes e atrasados (próximos 30d + atrasados) + avisos recentes
r.get('/upcoming', async (_req, res, next) => {
  try {
    const db = await getDb();
    const visibleCourses = await db
      .collection('canvas_courses')
      .find({ active: true, hidden: { $ne: true }, has_grades: true }, { projection: { canvas_id: 1 } })
      .toArray();
    const visibleIds = visibleCourses.map((c) => Number(c.canvas_id));

    if (visibleIds.length === 0) {
      res.json({ assignments: [], announcements: [] });
      return;
    }

    const now = new Date();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [rawAssignments, announcements, deliverables] = await Promise.all([
      db
        .collection('canvas_assignments')
        .find({
          course_id: { $in: visibleIds },
          $or: [{ due_at: { $lte: thirtyDaysAhead } }, { due_at: null }],
        })
        .sort({ due_at: 1, name: 1 })
        .limit(120)
        .toArray(),
      db
        .collection('canvas_announcements')
        .find({ course_id: { $in: visibleIds } })
        .sort({ posted_at: -1 })
        .limit(20)
        .toArray(),
      db
        .collection('puc_deliverables')
        .find(
          { course_id: { $in: visibleIds } },
          {
            projection: {
              course_id: 1,
              assignment_id: 1,
              status: 1,
              current_markdown: 1,
              last_published_url: 1,
              pending_html_url: 1,
              pending_github_paths: 1,
              statement_changed: 1,
              is_handwritten: 1,
            },
          }
        )
        .toArray(),
    ]);

    const delivByKey = new Map(deliverables.map((d) => [`${d.course_id}:${d.assignment_id}`, d]));

    const pendingOrOverdue = rawAssignments
      .map((a) => mapAssignment(a, now, delivByKey.get(`${a.course_id}:${a.canvas_id}`)))
      .filter((a) => a.deliveryStatus === 'pendente' || a.deliveryStatus === 'atrasado')
      .slice(0, 60);

    res.json({
      assignments: pendingOrOverdue,
      announcements: announcements.map((a) => ({
        id: Number(a.canvas_id),
        courseId: Number(a.course_id),
        courseName: String(a.course_name || ''),
        title: String(a.title || ''),
        message: String(a.message || ''),
        postedAt: a.posted_at ?? null,
        htmlUrl: a.html_url ?? null,
        authorName: a.author_name ?? null,
        read: Boolean(a.read),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/:cid/assignments
r.get('/:cid/assignments', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    if (!cid) {
      res.status(400).json({ error: 'course_id_invalido' });
      return;
    }
    const db = await getDb();
    const now = new Date();
    const [list, deliverables] = await Promise.all([
      db
        .collection('canvas_assignments')
        .find({ course_id: cid })
        .sort({ due_at: 1, name: 1 })
        .toArray(),
      db
        .collection('puc_deliverables')
        .find(
          { course_id: cid },
          {
            projection: {
              assignment_id: 1,
              status: 1,
              current_markdown: 1,
              last_published_url: 1,
              pending_html_url: 1,
              pending_github_paths: 1,
              statement_changed: 1,
              is_handwritten: 1,
            },
          }
        )
        .toArray(),
    ]);
    const delivByAid = new Map(deliverables.map((d) => [Number(d.assignment_id), d]));

    res.json(list.map((a) => mapAssignment(a, now, delivByAid.get(Number(a.canvas_id)))));
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/:cid/assignments/:aid
r.get('/:cid/assignments/:aid', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    const aid = parseNumericId(req.params.aid);
    if (!cid || !aid) {
      res.status(400).json({ error: 'parametros_invalidos' });
      return;
    }
    const db = await getDb();
    const doc = await db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid });
    if (!doc) {
      res.status(404).json({ error: 'trabalho_nao_encontrado' });
      return;
    }
    res.json(mapAssignment(doc, new Date()));
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/:cid/announcements
r.get('/:cid/announcements', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    if (!cid) {
      res.status(400).json({ error: 'course_id_invalido' });
      return;
    }
    const db = await getDb();
    const list = await db
      .collection('canvas_announcements')
      .find({ course_id: cid })
      .sort({ posted_at: -1 })
      .toArray();

    res.json(
      list.map((a) => ({
        id: Number(a.canvas_id),
        courseId: Number(a.course_id),
        courseName: String(a.course_name || ''),
        title: String(a.title || ''),
        message: String(a.message || ''),
        postedAt: a.posted_at ?? null,
        htmlUrl: a.html_url ?? null,
        authorName: a.author_name ?? null,
        read: Boolean(a.read),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/puc/:cid/announcements/:aid/read -> marca aviso como lido
r.post('/:cid/announcements/:aid/read', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    const aid = parseNumericId(req.params.aid);
    if (!cid || !aid) {
      res.status(400).json({ error: 'parametros_invalidos' });
      return;
    }
    const db = await getDb();
    await db
      .collection('canvas_announcements')
      .updateOne({ course_id: cid, canvas_id: aid }, { $set: { read: true } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/:cid/pages
r.get('/:cid/pages', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    if (!cid) {
      res.status(400).json({ error: 'course_id_invalido' });
      return;
    }
    const db = await getDb();
    const list = await db
      .collection('canvas_pages')
      .find({ course_id: cid }, { projection: { body: 0 } })
      .sort({ title: 1 })
      .toArray();

    res.json(
      list.map((p) => ({
        slug: String(p.slug || ''),
        courseId: Number(p.course_id),
        title: String(p.title || ''),
        htmlUrl: p.html_url ?? null,
        updatedAt: p.updated_at ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/:cid/pages/:slug
r.get('/:cid/pages/:slug', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    const slug = req.params.slug;
    if (!cid || !isValidSlug(slug)) {
      res.status(400).json({ error: 'parametros_invalidos' });
      return;
    }
    const db = await getDb();
    const page = await db.collection('canvas_pages').findOne({ course_id: cid, slug });
    if (!page) {
      res.status(404).json({ error: 'pagina_nao_encontrada' });
      return;
    }

    res.json({
      slug: String(page.slug),
      courseId: Number(page.course_id),
      title: String(page.title || ''),
      body: String(page.body || ''),
      htmlUrl: page.html_url ?? null,
      updatedAt: page.updated_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/puc/:cid/files
r.get('/:cid/files', async (req, res, next) => {
  try {
    const cid = parseNumericId(req.params.cid);
    if (!cid) {
      res.status(400).json({ error: 'course_id_invalido' });
      return;
    }
    const db = await getDb();
    const list = await db
      .collection('canvas_files')
      .find({ course_id: cid })
      .sort({ origin_path: 1, display_name: 1 })
      .toArray();

    res.json(
      list.map((f) => ({
        id: Number(f.canvas_id),
        courseId: Number(f.course_id),
        displayName: String(f.display_name || f.filename || ''),
        filename: String(f.filename || ''),
        originPath: String(f.origin_path || 'Raiz'),
        size: Number(f.size || 0),
        contentType: String(f.content_type || 'application/octet-stream'),
        updatedAt: f.updated_at ?? null,
        htmlUrl: f.html_url ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

export default r;
