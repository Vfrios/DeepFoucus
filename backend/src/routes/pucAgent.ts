import { NextFunction, Request, Response, Router } from 'express';
import { getDb } from '../lib/mongo';
import {
  AGENT_STATUS_LABEL,
  AgentRecordStatus,
} from '../lib/pucAgentCore';
import {
  cancelAgentJob,
  enqueueAgentJob,
  getAgentQuotaUsage,
  getPucAgentConfig,
  savePucAgentConfig,
} from '../lib/pucAgentRunner';
import { resolveCourseAcronym } from '../lib/pucGithub';

function parseNumericId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function createPucAgentRouter(
  pucAuth: (req: Request, res: Response, next: NextFunction) => void
): Router {
  const r = Router();
  r.use(pucAuth);

  // GET /api/puc/agent/status -> configuração, cotas, consumo estimado por provedor, decisões recentes e jobs
  r.get('/status', async (_req, res, next) => {
    try {
      const db = await getDb();
      const now = new Date();
      const [config, quota, records, jobs, costByProviderRaw, courses] = await Promise.all([
        getPucAgentConfig(db),
        getAgentQuotaUsage(db, now),
        db
          .collection('puc_agent_records')
          .find()
          .sort({ updated_at: -1 })
          .limit(120)
          .toArray(),
        db
          .collection('puc_jobs')
          .find()
          .sort({ created_at: -1 })
          .limit(40)
          .toArray(),
        db
          .collection('puc_jobs')
          .aggregate([
            { $match: { type: 'agent_generate', 'telemetry.provider': { $type: 'string' } } },
            {
              $group: {
                _id: '$telemetry.provider',
                generations: { $sum: 1 },
                estimatedCostUsd: { $sum: { $ifNull: ['$telemetry.estimated_cost_usd', 0] } },
              },
            },
          ])
          .toArray(),
        db
          .collection('canvas_courses')
          .find({ active: true, has_grades: true }, { projection: { canvas_id: 1, name: 1, hidden: 1, ai_allowed: 1, aliases: 1, auto_aliases: 1, course_code: 1 } })
          .sort({ name: 1 })
          .toArray(),
      ]);

      const costByProvider = costByProviderRaw.map((row: any) => ({
        provider: String(row._id || 'desconhecido'),
        generations: Number(row.generations || 0),
        estimatedCostUsd: Number(Number(row.estimatedCostUsd || 0).toFixed(6)),
      }));
      const totalEstimatedCostUsd = Number(
        costByProvider.reduce((acc, item) => acc + item.estimatedCostUsd, 0).toFixed(6)
      );

      res.json({
        config: {
          enabled: config.enabled,
          paused: config.paused,
          activatedAt: config.activatedAt ? config.activatedAt.toISOString() : null,
          maxPerSync: config.maxPerSync,
          maxPerDay: config.maxPerDay,
          maxPerWeek: config.maxPerWeek,
          overdueToleranceDays: config.overdueToleranceDays,
          preferredProvider: config.preferredProvider,
          courseOverrides: config.courseOverrides,
        },
        quota: {
          todayUsed: quota.todayCount,
          todayLimit: config.maxPerDay,
          weekUsed: quota.weekCount,
          weekLimit: config.maxPerWeek,
          perSyncLimit: config.maxPerSync,
        },
        costs: {
          totalEstimatedCostUsd,
          byProvider: costByProvider,
        },
        courses: courses.map((c: any) => {
          const cid = Number(c.canvas_id);
          const override = config.courseOverrides[String(cid)];
          const aiAllowed = c.ai_allowed !== false;
          return {
            id: cid,
            name: String(c.name || ''),
            acronym: resolveCourseAcronym({
              aliases: c.aliases,
              auto_aliases: c.auto_aliases,
              course_code: c.course_code,
              name: String(c.name || ''),
            }),
            hidden: Boolean(c.hidden),
            aiAllowed,
            agentEnabled: aiAllowed && (override ? override.enabled !== false : true),
          };
        }),
        decisions: records.map((rec: any) => {
          const st = (rec.status || 'ignorado') as AgentRecordStatus;
          return {
            courseId: Number(rec.course_id),
            assignmentId: Number(rec.assignment_id),
            courseName: String(rec.course_name || ''),
            courseAcronym: String(rec.course_acronym || 'PUC'),
            assignmentName: String(rec.assignment_name || ''),
            dueAt: rec.due_at ?? null,
            status: st,
            statusLabel: AGENT_STATUS_LABEL[st] || st,
            reasonCode: rec.decision_reason_code ?? null,
            reason: String(rec.decision_reason || ''),
            isPossibleQuiz: Boolean(rec.is_possible_quiz),
            alwaysIgnore: Boolean(rec.always_ignore),
            statementChanged: Boolean(rec.statement_changed),
            pendingHtmlUrl: rec.pending_html_url ?? null,
            pendingFolderUrl: rec.pending_folder_url ?? null,
            provider: rec.provider ?? null,
            model: rec.model ?? null,
            estimatedCostUsd: typeof rec.estimated_cost_usd === 'number' ? rec.estimated_cost_usd : null,
            lastJobId: rec.last_job_id ?? null,
            lastError: rec.last_error ?? null,
            updatedAt: rec.updated_at ?? null,
          };
        }),
        jobs: jobs.map((j: any) => ({
          jobId: String(j.job_id),
          courseId: Number(j.course_id),
          assignmentId: Number(j.assignment_id),
          courseAcronym: String(j.course_acronym || 'PUC'),
          assignmentName: String(j.assignment_name || ''),
          trigger: j.trigger || 'sync',
          status: j.status,
          stage: String(j.stage || ''),
          progress: Number(j.progress || 0),
          attempts: Number(j.attempts || 0),
          maxAttempts: Number(j.max_attempts || 3),
          error: j.error ?? null,
          telemetry: j.telemetry || {},
          createdAt: j.created_at ?? null,
          startedAt: j.started_at ?? null,
          finishedAt: j.finished_at ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/puc/agent/config -> liga/desliga global, pausa, limites e interruptor por curso
  r.patch('/config', async (req, res, next) => {
    try {
      const db = await getDb();
      const body = req.body || {};
      const patch: Parameters<typeof savePucAgentConfig>[1] = {};

      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.paused === 'boolean') patch.paused = body.paused;
      if (typeof body.maxPerSync === 'number') patch.maxPerSync = body.maxPerSync;
      if (typeof body.maxPerDay === 'number') patch.maxPerDay = body.maxPerDay;
      if (typeof body.maxPerWeek === 'number') patch.maxPerWeek = body.maxPerWeek;
      if (typeof body.overdueToleranceDays === 'number') {
        patch.overdueToleranceDays = body.overdueToleranceDays;
      }
      if (typeof body.preferredProvider === 'string') {
        patch.preferredProvider = body.preferredProvider as any;
      }
      if (body.courseOverride && typeof body.courseOverride.courseId === 'number') {
        patch.courseOverride = {
          courseId: body.courseOverride.courseId,
          enabled: Boolean(body.courseOverride.enabled),
        };
      }

      const updated = await savePucAgentConfig(db, patch);
      res.json({
        ok: true,
        config: {
          ...updated,
          activatedAt: updated.activatedAt ? updated.activatedAt.toISOString() : null,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/agent/assignments/:cid/:aid/force-generate -> "Gerar mesmo assim" / "Tentar de novo" / "Regerar"
  r.post('/assignments/:cid/:aid/force-generate', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const db = await getDb();
      const [course, assignment] = await Promise.all([
        db.collection('canvas_courses').findOne({ canvas_id: cid }),
        db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
      ]);

      if (!assignment || !course) {
        res.status(404).json({ error: 'trabalho_nao_encontrado' });
        return;
      }
      if (course.ai_allowed === false) {
        res.status(403).json({ error: 'IA permitida está desligada para este curso.' });
        return;
      }

      const acronym = resolveCourseAcronym({
        aliases: course.aliases,
        auto_aliases: course.auto_aliases,
        course_code: course.course_code,
        name: String(course.name || assignment.course_name || 'PUC'),
      });
      const trigger = req.body?.trigger === 'retry' ? 'retry' : 'manual_force';

      const queued = await enqueueAgentJob(db, {
        courseId: cid,
        assignmentId: aid,
        courseName: String(course.name || assignment.course_name || ''),
        courseAcronym: acronym,
        assignmentName: String(assignment.name || ''),
        dueAt: assignment.due_at ?? null,
        trigger,
      });

      res.status(202).json({
        ok: true,
        jobId: queued.jobId,
        alreadyActive: queued.alreadyActive,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/agent/assignments/:cid/:aid/ignore -> "Ignorar sempre este trabalho"
  r.post('/assignments/:cid/:aid/ignore', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const db = await getDb();
      const now = new Date();
      const activeJob = await db.collection('puc_jobs').findOne({
        course_id: cid,
        assignment_id: aid,
        status: { $in: ['queued', 'running'] },
      });
      if (activeJob?.job_id) {
        await cancelAgentJob(db, String(activeJob.job_id));
      }

      await db.collection('puc_agent_records').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            always_ignore: true,
            status: 'ignorado' as AgentRecordStatus,
            decision_reason_code: 'always_ignore',
            decision_reason: 'Ignorado permanentemente pelo usuário',
            is_possible_quiz: false,
            updated_at: now,
          },
          $setOnInsert: {
            course_id: cid,
            assignment_id: aid,
            created_at: now,
          },
        },
        { upsert: true }
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/agent/assignments/:cid/:aid/unignore -> remove "Ignorar sempre"
  r.post('/assignments/:cid/:aid/unignore', async (req, res, next) => {
    try {
      const cid = parseNumericId(req.params.cid);
      const aid = parseNumericId(req.params.aid);
      if (!cid || !aid) {
        res.status(400).json({ error: 'parametros_invalidos' });
        return;
      }

      const db = await getDb();
      await db.collection('puc_agent_records').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            always_ignore: false,
            decision_reason: 'Desbloqueado pelo usuário',
            updated_at: new Date(),
          },
        }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/puc/agent/jobs/:jobId/cancel -> cancela job assíncrono na fila ou em execução
  r.post('/jobs/:jobId/cancel', async (req, res, next) => {
    try {
      const jobId = String(req.params.jobId || '').trim();
      if (!jobId || jobId.length > 100) {
        res.status(400).json({ error: 'job_id_invalido' });
        return;
      }
      const db = await getDb();
      const cancelled = await cancelAgentJob(db, jobId);
      res.json({ ok: true, cancelled });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
