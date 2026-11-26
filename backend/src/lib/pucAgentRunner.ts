import crypto from 'crypto';
import type { Db } from 'mongodb';
import { sendPushToAll, sendPushToUser } from '../routes/push';
import { getCanvasToken, markCanvasToken401 } from './canvasAuth';
import { saoPauloDayBounds } from './canvasUtils';
import {
  AgentAssignmentInput,
  AgentCourseInput,
  AgentPushEvent,
  AgentPushPayload,
  AgentRecordStatus,
  buildAgentNotificationPayload,
  buildGroupedAgentSyncPush,
  computeStatementHash,
  estimateAiCostUsd,
  evaluateAssignmentEligibility,
  getDefaultAgentConfig,
  PucAgentConfig,
  sortCandidatesByDueDate,
} from './pucAgentCore';
import {
  downloadAndExtractCanvasAttachment,
  generateDeliverable,
  PdfVisionPage,
} from './pucAssistantAi';
import {
  AssignmentRecord,
  buildDeliverableContext,
  buildUnderstandingSummary,
  canGenerateForPart,
  CourseLessonSummary,
  DeliverableStatus,
  extractCanvasFileRefsFromHtml,
  extractCodeFilesFromMarkdown,
  ExtractedAttachmentText,
  formatHandwrittenCopyTxt,
  PreviousPartApprovedInput,
  PreviousSubmissionInput,
  sanitizeHtmlToText,
} from './pucAssistantCore';
import { generateDeliverableCodeZipBuffer, generateDeliverablePdfBuffer } from './pucAssistantPdf';
import {
  buildPendingDeliverableGithubPaths,
  getGithubTokenAndConfig,
  GithubFileToCommit,
  markGithubAuthError,
  publishDeliverableToGithub,
  resolveCourseAcronym,
  sha256Text,
} from './pucGithub';

const AGENT_CONFIG_DOC_ID = 'puc_agent' as const;
const DEFAULT_JOB_TIMEOUT_MS = Math.max(
  30_000,
  Math.min(600_000, Number(process.env.PUC_AGENT_JOB_TIMEOUT_MS || 180_000) || 180_000)
);
const DEFAULT_MAX_RETRIES = Math.max(
  0,
  Math.min(3, Number(process.env.PUC_AGENT_MAX_RETRIES || 2) || 2)
);

export type PucJobStatus = 'queued' | 'running' | 'completed' | 'needs_user' | 'failed' | 'cancelled';

export interface PucJobDoc {
  job_id: string;
  type: 'agent_generate';
  course_id: number;
  assignment_id: number;
  course_name: string;
  course_acronym: string;
  assignment_name: string;
  trigger: 'sync' | 'manual_force' | 'retry' | 'multipart_unlock';
  status: PucJobStatus;
  stage: string;
  progress: number;
  attempts: number;
  max_attempts: number;
  priority_due_at: Date | null;
  timeout_ms: number;
  error: string | null;
  telemetry: {
    duration_ms?: number;
    provider?: string | null;
    model?: string | null;
    estimated_cost_usd?: number;
    input_chars?: number;
    output_chars?: number;
    completeness_retried?: boolean;
    vision_pages_used?: number;
  };
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Date;
}

let workerRunning = false;
let workerKickPending = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
const cancelledJobIds = new Set<string>();

async function sendOwnerPush(payload: AgentPushPayload): Promise<void> {
  try {
    const ownerEmail = (process.env.EMAIL_VITOR || '').trim();
    let sent = 0;
    if (ownerEmail) {
      const res = await sendPushToUser(ownerEmail, payload);
      sent = res.sent;
    }
    if (sent === 0) {
      await sendPushToAll(payload);
    }
  } catch (err) {
    console.error('[puc/agent/push] erro ao enviar Web Push:', err instanceof Error ? err.message : String(err));
  }
}

export async function getPucAgentConfig(db: Db): Promise<PucAgentConfig> {
  const defaults = getDefaultAgentConfig();
  const doc = await db.collection('puc_agent_config').findOne({ _id: AGENT_CONFIG_DOC_ID as any });
  if (!doc) return defaults;

  return {
    enabled: Boolean(doc.enabled),
    paused: Boolean(doc.paused),
    activatedAt: doc.activated_at ? new Date(doc.activated_at) : null,
    maxPerSync: typeof doc.max_per_sync === 'number' && doc.max_per_sync >= 1 ? doc.max_per_sync : defaults.maxPerSync,
    maxPerDay: typeof doc.max_per_day === 'number' && doc.max_per_day >= 1 ? doc.max_per_day : defaults.maxPerDay,
    maxPerWeek: typeof doc.max_per_week === 'number' && doc.max_per_week >= 1 ? doc.max_per_week : defaults.maxPerWeek,
    overdueToleranceDays:
      typeof doc.overdue_tolerance_days === 'number' && doc.overdue_tolerance_days >= 0
        ? doc.overdue_tolerance_days
        : defaults.overdueToleranceDays,
    preferredProvider:
      doc.preferred_provider === 'gemini' ||
      doc.preferred_provider === 'groq' ||
      doc.preferred_provider === 'openrouter'
        ? doc.preferred_provider
        : 'auto',
    courseOverrides:
      doc.course_overrides && typeof doc.course_overrides === 'object' ? doc.course_overrides : {},
  };
}

export async function savePucAgentConfig(
  db: Db,
  patch: Partial<{
    enabled: boolean;
    paused: boolean;
    maxPerSync: number;
    maxPerDay: number;
    maxPerWeek: number;
    overdueToleranceDays: number;
    preferredProvider: 'auto' | 'gemini' | 'groq' | 'openrouter';
    courseOverride: { courseId: number; enabled: boolean };
  }>,
  now = new Date()
): Promise<PucAgentConfig> {
  const current = await getPucAgentConfig(db);
  const $set: Record<string, unknown> = { updated_at: now };

  if (typeof patch.enabled === 'boolean') {
    $set.enabled = patch.enabled;
    // Primeira ativação: registra data para nunca gerar retroativamente trabalhos antigos
    if (patch.enabled && !current.activatedAt) {
      $set.activated_at = now;
    }
  }
  if (typeof patch.paused === 'boolean') {
    $set.paused = patch.paused;
  }
  if (typeof patch.maxPerSync === 'number' && Number.isFinite(patch.maxPerSync)) {
    $set.max_per_sync = Math.max(1, Math.min(20, Math.floor(patch.maxPerSync)));
  }
  if (typeof patch.maxPerDay === 'number' && Number.isFinite(patch.maxPerDay)) {
    $set.max_per_day = Math.max(1, Math.min(50, Math.floor(patch.maxPerDay)));
  }
  if (typeof patch.maxPerWeek === 'number' && Number.isFinite(patch.maxPerWeek)) {
    $set.max_per_week = Math.max(1, Math.min(200, Math.floor(patch.maxPerWeek)));
  }
  if (typeof patch.overdueToleranceDays === 'number' && Number.isFinite(patch.overdueToleranceDays)) {
    $set.overdue_tolerance_days = Math.max(0, Math.min(60, Math.floor(patch.overdueToleranceDays)));
  }
  if (
    patch.preferredProvider === 'auto' ||
    patch.preferredProvider === 'gemini' ||
    patch.preferredProvider === 'groq' ||
    patch.preferredProvider === 'openrouter'
  ) {
    $set.preferred_provider = patch.preferredProvider;
  }
  if (patch.courseOverride) {
    const nextOverrides = { ...current.courseOverrides };
    nextOverrides[String(patch.courseOverride.courseId)] = { enabled: Boolean(patch.courseOverride.enabled) };
    $set.course_overrides = nextOverrides;
  }

  await db.collection('puc_agent_config').updateOne(
    { _id: AGENT_CONFIG_DOC_ID as any },
    {
      $set,
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );

  const updated = await getPucAgentConfig(db);
  if (updated.enabled && !updated.paused) {
    kickPucAgentWorker(db);
  }
  return updated;
}

export async function getAgentQuotaUsage(db: Db, now = new Date()): Promise<{
  todayCount: number;
  weekCount: number;
}> {
  const { todayStart } = saoPauloDayBounds(now);
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);

  const jobsCol = db.collection('puc_jobs');
  const countableStatuses: PucJobStatus[] = ['queued', 'running', 'completed', 'needs_user'];
  const [todayCount, weekCount] = await Promise.all([
    jobsCol.countDocuments({
      type: 'agent_generate',
      status: { $in: countableStatuses },
      created_at: { $gte: todayStart },
    }),
    jobsCol.countDocuments({
      type: 'agent_generate',
      status: { $in: countableStatuses },
      created_at: { $gte: weekStart },
    }),
  ]);
  return { todayCount, weekCount };
}

export async function enqueueAgentJob(
  db: Db,
  params: {
    courseId: number;
    assignmentId: number;
    courseName: string;
    courseAcronym: string;
    assignmentName: string;
    dueAt?: Date | string | null;
    trigger: 'sync' | 'manual_force' | 'retry' | 'multipart_unlock';
    now?: Date;
  }
): Promise<{ jobId: string; alreadyActive: boolean }> {
  const now = params.now ?? new Date();
  const jobsCol = db.collection('puc_jobs');

  // Idempotência: evita duplicar job ativo para o mesmo trabalho
  const existingActive = await jobsCol.findOne({
    course_id: params.courseId,
    assignment_id: params.assignmentId,
    status: { $in: ['queued', 'running'] },
  });
  if (existingActive) {
    return { jobId: String(existingActive.job_id), alreadyActive: true };
  }

  const jobId = `pucjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const dueDate = params.dueAt ? new Date(params.dueAt) : null;
  const priorityDueAt = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;

  const jobDoc: PucJobDoc = {
    job_id: jobId,
    type: 'agent_generate',
    course_id: params.courseId,
    assignment_id: params.assignmentId,
    course_name: params.courseName,
    course_acronym: params.courseAcronym,
    assignment_name: params.assignmentName,
    trigger: params.trigger,
    status: 'queued',
    stage: 'Na fila',
    progress: 0,
    attempts: 0,
    max_attempts: DEFAULT_MAX_RETRIES + 1,
    priority_due_at: priorityDueAt,
    timeout_ms: DEFAULT_JOB_TIMEOUT_MS,
    error: null,
    telemetry: {},
    created_at: now,
    started_at: null,
    finished_at: null,
    updated_at: now,
  };

  await jobsCol.insertOne(jobDoc as any);

  await db.collection('puc_agent_records').updateOne(
    { course_id: params.courseId, assignment_id: params.assignmentId },
    {
      $set: {
        course_id: params.courseId,
        assignment_id: params.assignmentId,
        course_name: params.courseName,
        course_acronym: params.courseAcronym,
        assignment_name: params.assignmentName,
        due_at: priorityDueAt,
        status: 'na_fila' as AgentRecordStatus,
        decision_reason:
          params.trigger === 'manual_force'
            ? 'Enfileirado manualmente ("Gerar mesmo assim")'
            : params.trigger === 'retry'
              ? 'Nova tentativa solicitada'
              : params.trigger === 'multipart_unlock'
                ? 'Próxima parte liberada após correção da anterior'
                : 'Enfileirado automaticamente pelo sync',
        is_possible_quiz: false,
        always_ignore: false,
        statement_changed: false,
        last_job_id: jobId,
        last_error: null,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );

  kickPucAgentWorker(db);
  return { jobId, alreadyActive: false };
}

export async function cancelAgentJob(db: Db, jobId: string): Promise<boolean> {
  cancelledJobIds.add(jobId);
  const now = new Date();
  const res = await db.collection('puc_jobs').findOneAndUpdate(
    { job_id: jobId, status: { $in: ['queued', 'running'] } },
    {
      $set: {
        status: 'cancelled' as PucJobStatus,
        stage: 'Cancelado pelo usuário',
        finished_at: now,
        updated_at: now,
      },
    },
    { returnDocument: 'after' }
  );

  if (res) {
    await db.collection('puc_agent_records').updateOne(
      { course_id: Number(res.course_id), assignment_id: Number(res.assignment_id) },
      {
        $set: {
          status: 'ignorado' as AgentRecordStatus,
          decision_reason: 'Job cancelado pelo usuário',
          updated_at: now,
        },
      }
    );
    return true;
  }
  return false;
}

// ---- Gatilho ao final do sync leve ----

export interface SyncAgentEvaluationResult {
  enqueued: number;
  queuedForLater: number;
  ignored: number;
  statementChanged: number;
  pushSent: boolean;
}

export async function evaluateAgentAfterSync(
  db: Db,
  params: {
    courses: any[];
    changedStatementKeys: Array<{ courseId: number; assignmentId: number }>;
    unlockedPartKeys: Array<{ courseId: number; assignmentId: number }>;
    now?: Date;
  }
): Promise<SyncAgentEvaluationResult> {
  const now = params.now ?? new Date();
  const config = await getPucAgentConfig(db);
  const result: SyncAgentEvaluationResult = {
    enqueued: 0,
    queuedForLater: 0,
    ignored: 0,
    statementChanged: 0,
    pushSent: false,
  };

  const courseById = new Map<number, any>(params.courses.map((c) => [Number(c.canvas_id), c]));
  const visibleCourseIds = params.courses.map((c) => Number(c.canvas_id));
  if (visibleCourseIds.length === 0) return result;

  const pushEvents: AgentPushEvent[] = [];

  // 1. Tratar alterações relevantes de enunciado em trabalhos já gerados (NUNCA regera sozinho!)
  if (params.changedStatementKeys.length > 0) {
    for (const pair of params.changedStatementKeys) {
      const [deliv, assign] = await Promise.all([
        db.collection('puc_deliverables').findOne({ course_id: pair.courseId, assignment_id: pair.assignmentId }),
        db.collection('canvas_assignments').findOne({ course_id: pair.courseId, canvas_id: pair.assignmentId }),
      ]);
      if (!deliv || !assign) continue;

      const course = courseById.get(pair.courseId);
      const acronym = resolveCourseAcronym({
        aliases: course?.aliases,
        auto_aliases: course?.auto_aliases,
        course_code: course?.course_code,
        name: String(course?.name || assign.course_name || 'PUC'),
      });
      const nextHash = computeStatementHash(assign.description);

      await Promise.all([
        db.collection('puc_deliverables').updateOne(
          { course_id: pair.courseId, assignment_id: pair.assignmentId },
          {
            $set: {
              statement_changed: true,
              statement_changed_at: now,
              latest_statement_hash: nextHash,
              updated_at: now,
            },
          }
        ),
        db.collection('puc_agent_records').updateOne(
          { course_id: pair.courseId, assignment_id: pair.assignmentId },
          {
            $set: {
              course_id: pair.courseId,
              assignment_id: pair.assignmentId,
              course_name: String(course?.name || assign.course_name || ''),
              course_acronym: acronym,
              assignment_name: String(assign.name || ''),
              due_at: assign.due_at ?? null,
              statement_changed: true,
              statement_hash: nextHash,
              decision_reason: 'Enunciado mudou no Canvas — aguarda você clicar em "Regerar"',
              updated_at: now,
            },
            $setOnInsert: { created_at: now, status: 'enviado_a_verificar' },
          },
          { upsert: true }
        ),
      ]);

      result.statementChanged += 1;
      pushEvents.push({
        kind: 'enunciado_mudou',
        courseAcronym: acronym,
        courseId: pair.courseId,
        assignmentId: pair.assignmentId,
        assignmentName: String(assign.name || ''),
        dueAt: assign.due_at ?? null,
      });
    }
  }

  // Se o agente global estiver desligado, envia apenas alertas de enunciado mudado (se houver) e sai
  if (!config.enabled) {
    const grouped = buildGroupedAgentSyncPush(pushEvents);
    if (grouped) {
      await sendOwnerPush(grouped);
      result.pushSent = true;
    }
    return result;
  }

  // 2. Buscar todos os trabalhos dos cursos visíveis + registros existentes do agente + entregas + jobs ativos
  const [allAssignments, agentRecords, deliverables, activeJobs, quota] = await Promise.all([
    db.collection('canvas_assignments').find({ course_id: { $in: visibleCourseIds } }).toArray(),
    db.collection('puc_agent_records').find({ course_id: { $in: visibleCourseIds } }).toArray(),
    db
      .collection('puc_deliverables')
      .find(
        { course_id: { $in: visibleCourseIds } },
        { projection: { course_id: 1, assignment_id: 1, status: 1 } }
      )
      .toArray(),
    db
      .collection('puc_jobs')
      .find(
        { course_id: { $in: visibleCourseIds }, status: { $in: ['queued', 'running'] } },
        { projection: { course_id: 1, assignment_id: 1 } }
      )
      .toArray(),
    getAgentQuotaUsage(db, now),
  ]);

  const assignmentByKey = new Map<string, any>(
    allAssignments.map((a) => [`${a.course_id}:${a.canvas_id}`, a])
  );
  const recordByKey = new Map<string, any>(
    agentRecords.map((r) => [`${r.course_id}:${r.assignment_id}`, r])
  );
  const delivByKey = new Map<string, any>(
    deliverables.map((d) => [`${d.course_id}:${d.assignment_id}`, d])
  );
  const activeJobKeys = new Set<string>(
    activeJobs.map((j) => `${j.course_id}:${j.assignment_id}`)
  );
  const unlockedKeys = new Set<string>(
    params.unlockedPartKeys.map((p) => `${p.courseId}:${p.assignmentId}`)
  );

  // Candidatos: trabalhos SEM registro de agente ainda, OU que estavam 'na_fila', OU cuja parte anterior acabou de ser corrigida
  const candidates = allAssignments.filter((a) => {
    const key = `${a.course_id}:${a.canvas_id}`;
    const rec = recordByKey.get(key);
    if (!rec) return true;
    if (rec.always_ignore) return false;
    if (rec.status === 'na_fila') return true;
    if (rec.decision_reason_code === 'multipart_gate_blocked' && unlockedKeys.has(key)) return true;
    return false;
  });

  // Priorizar por prazo mais próximo
  const sortedCandidates = sortCandidatesByDueDate(candidates as any[]);

  let generatedThisSync = 0;
  let generatedToday = quota.todayCount;
  let generatedThisWeek = quota.weekCount;

  for (const a of sortedCandidates) {
    const cid = Number(a.course_id);
    const aid = Number(a.canvas_id);
    const key = `${cid}:${aid}`;
    const course = courseById.get(cid);
    if (!course) continue;

    const existingRec = recordByKey.get(key);
    const existingDeliv = delivByKey.get(key);
    const depDoc =
      typeof a.depends_on === 'number'
        ? (assignmentByKey.get(`${cid}:${a.depends_on}`) as unknown as AssignmentRecord | undefined) ?? null
        : null;

    const decision = evaluateAssignmentEligibility({
      assignment: a as unknown as AgentAssignmentInput,
      course: course as unknown as AgentCourseInput,
      config,
      now,
      alwaysIgnore: Boolean(existingRec?.always_ignore),
      hasExistingDeliverable: Boolean(existingDeliv),
      hasActiveJob: activeJobKeys.has(key),
      dependsOnAssignment: depDoc,
      deliverableStatus: (existingDeliv?.status as DeliverableStatus | undefined) ?? null,
      generatedThisSync,
      generatedToday,
      generatedThisWeek,
    });

    const acronym = resolveCourseAcronym({
      aliases: course?.aliases,
      auto_aliases: course?.auto_aliases,
      course_code: course?.course_code,
      name: String(course?.name || a.course_name || 'PUC'),
    });
    const stmtHash = a.statement_hash || computeStatementHash(a.description);

    if (decision.outcome === 'eligible') {
      const trigger = unlockedKeys.has(key) ? 'multipart_unlock' : 'sync';
      await enqueueAgentJob(db, {
        courseId: cid,
        assignmentId: aid,
        courseName: String(course.name || a.course_name || ''),
        courseAcronym: acronym,
        assignmentName: String(a.name || ''),
        dueAt: a.due_at ?? null,
        trigger,
        now,
      });
      await db.collection('puc_agent_records').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            decision_reason_code: decision.reasonCode,
            statement_hash: stmtHash,
          },
        }
      );

      generatedThisSync += 1;
      generatedToday += 1;
      generatedThisWeek += 1;
      result.enqueued += 1;

      pushEvents.push({
        kind: 'novo_trabalho',
        courseAcronym: acronym,
        courseId: cid,
        assignmentId: aid,
        assignmentName: String(a.name || ''),
        description: a.description ?? null,
        dueAt: a.due_at ?? null,
      });
    } else if (decision.outcome === 'queued') {
      // Passou do limite ou agente pausado -> fica na fila sem perder
      await db.collection('puc_agent_records').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            course_id: cid,
            assignment_id: aid,
            course_name: String(course.name || a.course_name || ''),
            course_acronym: acronym,
            assignment_name: String(a.name || ''),
            due_at: a.due_at ?? null,
            status: 'na_fila' as AgentRecordStatus,
            decision_reason_code: decision.reasonCode,
            decision_reason: decision.reasonLabel,
            is_possible_quiz: false,
            statement_hash: stmtHash,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
            always_ignore: false,
          },
        },
        { upsert: true }
      );
      result.queuedForLater += 1;
    } else {
      // Ignorado -> registra o motivo no Mongo
      await db.collection('puc_agent_records').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            course_id: cid,
            assignment_id: aid,
            course_name: String(course.name || a.course_name || ''),
            course_acronym: acronym,
            assignment_name: String(a.name || ''),
            due_at: a.due_at ?? null,
            status: 'ignorado' as AgentRecordStatus,
            decision_reason_code: decision.reasonCode,
            decision_reason: decision.reasonLabel,
            is_possible_quiz: decision.isPossibleQuiz,
            statement_hash: stmtHash,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
            always_ignore: false,
          },
        },
        { upsert: true }
      );
      result.ignored += 1;
    }
  }

  // Agrupar notificações do mesmo sync (no máximo 1 push por sync)
  const grouped = buildGroupedAgentSyncPush(pushEvents);
  if (grouped) {
    await sendOwnerPush(grouped);
    result.pushSent = true;
  }

  return result;
}

// ---- Execução assíncrona de 1 job do agente (puc_jobs) ----

async function collectJobStatementAttachments(
  assignment: any,
  canvasToken: string | null,
  onUnauthorized: () => Promise<void>
): Promise<{ attachments: ExtractedAttachmentText[]; visionPages: PdfVisionPage[] }> {
  const attachments: ExtractedAttachmentText[] = [];
  const visionPages: PdfVisionPage[] = [];
  if (!canvasToken) return { attachments, visionPages };

  const htmlRefs = extractCanvasFileRefsFromHtml(assignment?.description);
  const seenIds = new Set<number>();
  const targets: Array<{ fileId: number; name: string; contentType: string }> = [];
  for (const ref of htmlRefs) {
    if (seenIds.has(ref.fileId)) continue;
    seenIds.add(ref.fileId);
    targets.push({
      fileId: ref.fileId,
      name: ref.label,
      contentType: ref.label.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
    });
  }

  for (const t of targets.slice(0, 4)) {
    const res = await downloadAndExtractCanvasAttachment(
      t.fileId,
      t.name,
      t.contentType,
      canvasToken,
      onUnauthorized,
      { includeVision: true }
    );
    attachments.push(res.attachment);
    if (res.visionPages.length > 0) visionPages.push(...res.visionPages);
  }
  return { attachments, visionPages };
}

async function updateJobProgress(
  db: Db,
  jobId: string,
  stage: string,
  progress: number
): Promise<void> {
  await db.collection('puc_jobs').updateOne(
    { job_id: jobId },
    { $set: { stage, progress, updated_at: new Date() } }
  );
}

function assertNotCancelled(jobId: string): void {
  if (cancelledJobIds.has(jobId)) {
    throw Object.assign(new Error('Job cancelado pelo usuário.'), { isCancelled: true });
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) em ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeSingleAgentJob(db: Db, job: PucJobDoc): Promise<void> {
  const startedMs = Date.now();
  const cid = Number(job.course_id);
  const aid = Number(job.assignment_id);
  const jobId = job.job_id;
  const timeoutMs = job.timeout_ms || DEFAULT_JOB_TIMEOUT_MS;

  const markNeedsUser = async (reason: string, extraTelemetry: Record<string, unknown> = {}) => {
    const finishedAt = new Date();
    await Promise.all([
      db.collection('puc_jobs').updateOne(
        { job_id: jobId },
        {
          $set: {
            status: 'needs_user' as PucJobStatus,
            stage: 'Precisa de você',
            progress: 100,
            error: reason,
            finished_at: finishedAt,
            updated_at: finishedAt,
            telemetry: { ...job.telemetry, ...extraTelemetry, duration_ms: Date.now() - startedMs },
          },
        }
      ),
      db.collection('puc_agent_records').updateOne(
        { course_id: cid, assignment_id: aid },
        {
          $set: {
            status: 'precisa_de_voce' as AgentRecordStatus,
            decision_reason: reason,
            last_error: reason,
            updated_at: finishedAt,
          },
        },
        { upsert: true }
      ),
    ]);

    const push = buildAgentNotificationPayload({
      kind: 'precisa_de_voce',
      courseAcronym: job.course_acronym,
      courseId: cid,
      assignmentId: aid,
      assignmentName: job.assignment_name,
      reason,
    });
    await sendOwnerPush(push);
  };

  await db.collection('puc_agent_records').updateOne(
    { course_id: cid, assignment_id: aid },
    {
      $set: {
        status: 'gerando' as AgentRecordStatus,
        decision_reason: 'Executando análise e geração automática',
        last_job_id: jobId,
        updated_at: new Date(),
      },
    },
    { upsert: true }
  );

  // Etapa 1: Carregar dados + rodar "O que entendi" automaticamente
  await updateJobProgress(db, jobId, 'Analisando enunciado e anexos ("O que entendi")', 15);
  assertNotCancelled(jobId);

  const [config, course, assignment, lessons, tokenAuth, existingDeliverable, gh] = await Promise.all([
    getPucAgentConfig(db),
    db.collection('canvas_courses').findOne({ canvas_id: cid }),
    db.collection('canvas_assignments').findOne({ course_id: cid, canvas_id: aid }),
    db.collection('puc_course_lessons').findOne({ course_id: cid }),
    getCanvasToken(db),
    db.collection('puc_deliverables').findOne({ course_id: cid, assignment_id: aid }),
    getGithubTokenAndConfig(db),
  ]);

  if (!assignment || !course) {
    await markNeedsUser('Trabalho ou curso não encontrado no banco sincronizado.');
    return;
  }

  if (course.ai_allowed === false) {
    await markNeedsUser('IA permitida está desligada para este curso.');
    return;
  }

  // Verificar gate multi-parte e carregar parte anterior verificada + nota + feedback
  let previousPartApproved: PreviousPartApprovedInput | null = null;
  if (assignment.assignment_kind === 'multi_part' && typeof assignment.depends_on === 'number') {
    const depDoc = (await db.collection('canvas_assignments').findOne({
      course_id: cid,
      canvas_id: assignment.depends_on,
    })) as unknown as AssignmentRecord | null;

    const gate = canGenerateForPart({
      assignment: assignment as unknown as AssignmentRecord,
      dependsOnAssignment: depDoc,
      deliverableStatus: (existingDeliverable?.status as DeliverableStatus | undefined) ?? null,
      now: new Date(),
    });
    if (!gate.allowed) {
      await markNeedsUser(gate.reason || 'Parte anterior do projeto ainda não corrigida no Canvas.');
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

  const onUnauthorized = async () => {
    await markCanvasToken401(db);
  };

  const { attachments: assignmentAttachments, visionPages } = await withTimeout(
    collectJobStatementAttachments(assignment, tokenAuth.token, onUnauthorized),
    Math.min(60_000, timeoutMs),
    'leitura de anexos'
  );
  assertNotCancelled(jobId);

  const understanding = buildUnderstandingSummary({
    courseId: cid,
    courseName: String(course.name || assignment.course_name || `Curso ${cid}`),
    assignment: assignment as unknown as AssignmentRecord,
    attachments: assignmentAttachments,
    myProject: typeof course.my_project === 'string' ? course.my_project : null,
  });

  // Se anexo ilegível (sem visão) ou divergência de título (baixa confiança), NÃO gerar!
  if (!understanding.canProceed && visionPages.length === 0) {
    await markNeedsUser(
      understanding.blockReason || 'Anexo ilegível ou vazio — cole o enunciado manualmente.'
    );
    return;
  }
  if (understanding.titleDivergence.hasDivergence) {
    await markNeedsUser(
      understanding.titleDivergence.reason ||
        'Baixa confiança: título do trabalho diverge do anexo. Confirme manualmente.'
    );
    return;
  }

  // Etapa 2: Montar contexto e gerar entrega (modelo rápido por padrão)
  await updateJobProgress(db, jobId, 'Montando contexto e gerando entrega com IA', 40);
  assertNotCancelled(jobId);

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
      .limit(3)
      .toArray(),
  ]);

  const previousSubmissions: PreviousSubmissionInput[] = otherAssignments.map((prev) => ({
    assignment_id: Number(prev.canvas_id),
    name: String(prev.name || ''),
    submitted_at: prev.submitted_at ?? prev.due_at ?? null,
    score: typeof prev.score === 'number' ? prev.score : null,
    points_possible: typeof prev.points_possible === 'number' ? prev.points_possible : null,
    grade: prev.grade ?? null,
    submitted_text: typeof prev.submission_body === 'string' ? prev.submission_body : null,
    attachments_text: [],
    comments: Array.isArray(prev.submission_comments) ? prev.submission_comments : [],
    rubric_assessment: prev.rubric_assessment ?? null,
    rubric: Array.isArray(prev.rubric) ? prev.rubric : [],
  }));

  const groupMembers = understanding.isGroup
    ? Array.isArray(course.group_members)
      ? course.group_members
      : []
    : [];
  const studentName = String(tokenAuth.doc?.canvas_user_name || 'Aluno PUC Minas').trim();

  const builtContext = buildDeliverableContext({
    courseName: String(course.name || assignment.course_name || ''),
    assignment: assignment as unknown as AssignmentRecord,
    assignmentAttachments,
    myProject: typeof course.my_project === 'string' ? course.my_project : null,
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
    studentName,
    isHandwritten: understanding.isHandwritten,
    isGroup: understanding.isGroup,
    detectedQuestions: understanding.questions,
    visionPagesUsed: visionPages.length,
  });

  let generated = await withTimeout(
    generateDeliverable({
      context: builtContext,
      visionImages: visionPages,
      preferredProvider: config.preferredProvider,
    }),
    timeoutMs,
    'geração com IA'
  );
  assertNotCancelled(jobId);

  let totalInputChars = builtContext.totalChars;
  let totalOutputChars = generated.text.length;
  let completenessRetried = false;

  // Etapa 3: Checagem de completude + validação de markdown (máx. 1 nova tentativa automática)
  await updateJobProgress(db, jobId, 'Validando completude e markdown', 65);
  const needsCompletenessRetry =
    (generated.completeness.expectedCount > 0 && !generated.completeness.passed) ||
    !generated.text.trim();

  if (needsCompletenessRetry) {
    completenessRetried = true;
    await updateJobProgress(db, jobId, 'Completude incompleta — tentando mais 1 vez', 72);
    const missingHint =
      generated.completeness.missingNumbers.length > 0
        ? `ATENÇÃO: Na tentativa anterior faltaram as questões ${generated.completeness.missingNumbers.join(', ')}. Responda TODAS as ${generated.completeness.expectedCount} questões numeradas na ordem exata.`
        : 'Gere a resposta completa em Markdown válido.';

    const retryGen = await withTimeout(
      generateDeliverable({
        context: builtContext,
        visionImages: visionPages,
        preferredProvider: config.preferredProvider,
        customInstructions: missingHint,
      }),
      timeoutMs,
      'retry de completude'
    );
    assertNotCancelled(jobId);
    totalInputChars += builtContext.totalChars;
    totalOutputChars += retryGen.text.length;
    generated = retryGen;
  }

  const estimatedCostUsd = estimateAiCostUsd({
    provider: generated.provider,
    model: generated.model,
    inputChars: totalInputChars,
    outputChars: totalOutputChars,
  });

  const stillIncomplete =
    (generated.completeness.expectedCount > 0 && !generated.completeness.passed) ||
    !generated.text.trim();

  const now = new Date();
  const stmtHash = assignment.statement_hash || computeStatementHash(assignment.description);

  if (stillIncomplete) {
    // Salva como rascunho para o usuário não perder o que foi gerado, e marca "precisa de você"
    await db.collection('puc_deliverables').updateOne(
      { course_id: cid, assignment_id: aid },
      {
        $set: {
          course_id: cid,
          course_name: String(course.name || assignment.course_name || ''),
          assignment_id: aid,
          assignment_name: String(assignment.name || ''),
          status: 'rascunho' as DeliverableStatus,
          current_markdown: generated.text,
          content_hash: sha256Text(generated.text),
          statement_hash: stmtHash,
          statement_changed: false,
          is_handwritten: builtContext.isHandwritten,
          is_group: builtContext.isGroup,
          expected_question_numbers: builtContext.detectedQuestions.questionNumbers,
          completeness: generated.completeness,
          used_sources: builtContext.usedSources,
          validation_warnings: generated.validation.warnings,
          student_name: studentName,
          group_members: groupMembers,
          last_provider: generated.provider,
          last_model: generated.model,
          estimated_cost_usd: estimatedCostUsd,
          generated_by_agent: true,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true }
    );

    await markNeedsUser(
      `Completude falhou após nova tentativa (faltam questões: ${generated.completeness.missingNumbers.join(', ') || 'conteúdo vazio'}).`,
      {
        provider: generated.provider,
        model: generated.model,
        estimated_cost_usd: estimatedCostUsd,
        input_chars: totalInputChars,
        output_chars: totalOutputChars,
        completeness_retried: completenessRetried,
      }
    );
    return;
  }

  // Etapa 4: Publicar no GitHub em pendentes/<semestre>/<sigla>/<trabalho>/
  await updateJobProgress(db, jobId, 'Publicando em pendentes/ no GitHub privado', 82);
  assertNotCancelled(jobId);

  if (!gh.doc || !gh.token) {
    // Salva rascunho no Mongo e avisa que precisa configurar GitHub
    await db.collection('puc_deliverables').updateOne(
      { course_id: cid, assignment_id: aid },
      {
        $set: {
          course_id: cid,
          course_name: String(course.name || assignment.course_name || ''),
          assignment_id: aid,
          assignment_name: String(assignment.name || ''),
          status: 'rascunho' as DeliverableStatus,
          current_markdown: generated.text,
          content_hash: sha256Text(generated.text),
          statement_hash: stmtHash,
          statement_changed: false,
          is_handwritten: builtContext.isHandwritten,
          is_group: builtContext.isGroup,
          expected_question_numbers: builtContext.detectedQuestions.questionNumbers,
          completeness: generated.completeness,
          used_sources: builtContext.usedSources,
          validation_warnings: generated.validation.warnings,
          student_name: studentName,
          group_members: groupMembers,
          last_provider: generated.provider,
          last_model: generated.model,
          estimated_cost_usd: estimatedCostUsd,
          generated_by_agent: true,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true }
    );
    await markNeedsUser('Entrega gerada em rascunho, mas GitHub privado não está configurado para publicar em pendentes/.', {
      provider: generated.provider,
      model: generated.model,
      estimated_cost_usd: estimatedCostUsd,
    });
    return;
  }

  const courseName = String(course.name || assignment.course_name || `Curso ${cid}`);
  const assignmentName = String(assignment.name || `Trabalho ${aid}`);
  const codeFiles = extractCodeFilesFromMarkdown(generated.text);
  const pendingPaths = buildPendingDeliverableGithubPaths({
    semester: String(course.term_name || 'sem-semestre'),
    courseAcronym: job.course_acronym,
    assignmentName,
    version: 1,
    isHandwritten: builtContext.isHandwritten,
    codeFiles,
  });

  const filesToCommit: GithubFileToCommit[] = [
    { path: pendingPaths.mdPath, content: Buffer.from(generated.text, 'utf8') },
  ];

  if (builtContext.isHandwritten && pendingPaths.txtPath) {
    const txtContent = formatHandwrittenCopyTxt(generated.text, { courseName, assignmentName });
    filesToCommit.push({ path: pendingPaths.txtPath, content: Buffer.from(txtContent, 'utf8') });
  } else if (pendingPaths.pdfPath) {
    const pdfBuffer = await generateDeliverablePdfBuffer({
      courseName,
      assignmentName,
      studentName,
      groupMembers,
      markdown: generated.text,
    });
    filesToCommit.push({ path: pendingPaths.pdfPath, content: pdfBuffer });
  }

  if (pendingPaths.codeFilePaths.length > 0 && pendingPaths.zipPath) {
    for (const cf of pendingPaths.codeFilePaths) {
      filesToCommit.push({ path: cf.path, content: Buffer.from(cf.content, 'utf8') });
    }
    const zipBuffer = await generateDeliverableCodeZipBuffer({
      assignmentName,
      markdown: generated.text,
      explicitFiles: codeFiles,
    });
    filesToCommit.push({ path: pendingPaths.zipPath, content: zipBuffer });
  }

  const published = await publishDeliverableToGithub(
    {
      token: gh.token,
      owner: gh.doc.owner,
      repo: gh.doc.repo,
      branch: gh.doc.branch || 'main',
      folderPath: pendingPaths.folderPath,
      commitMessage: pendingPaths.commitMessage,
      files: filesToCommit,
    },
    {
      onAuthError: (st) => markGithubAuthError(db, st),
    }
  );

  // Etapa 5: Atualizar status no Mongo para "enviado_a_verificar"
  await updateJobProgress(db, jobId, 'Salvando status e enviando notificação', 95);
  const finishedAt = new Date();
  const contentHash = sha256Text(generated.text);

  await Promise.all([
    db.collection('puc_deliverables').updateOne(
      { course_id: cid, assignment_id: aid },
      {
        $set: {
          course_id: cid,
          course_name: courseName,
          assignment_id: aid,
          assignment_name: assignmentName,
          status: 'enviado_a_verificar' as DeliverableStatus,
          current_markdown: generated.text,
          content_hash: contentHash,
          statement_hash: stmtHash,
          statement_changed: false,
          is_handwritten: builtContext.isHandwritten,
          is_group: builtContext.isGroup,
          expected_question_numbers: builtContext.detectedQuestions.questionNumbers,
          completeness: generated.completeness,
          used_sources: builtContext.usedSources,
          validation_warnings: generated.validation.warnings,
          student_name: studentName,
          group_members: groupMembers,
          last_provider: generated.provider,
          last_model: generated.model,
          estimated_cost_usd: estimatedCostUsd,
          generated_by_agent: true,
          pending_github_folder: pendingPaths.folderPath,
          pending_github_paths: published.paths,
          pending_commit_sha: published.commitSha,
          pending_html_url: published.htmlUrl,
          pending_folder_url: published.folderUrl,
          pending_published_at: finishedAt,
          updated_at: finishedAt,
        },
        $setOnInsert: { created_at: finishedAt, versions: [], publications: [] },
      },
      { upsert: true }
    ),
    db.collection('puc_agent_records').updateOne(
      { course_id: cid, assignment_id: aid },
      {
        $set: {
          status: 'enviado_a_verificar' as AgentRecordStatus,
          decision_reason: `Gerado via ${generated.providerLabel} (${generated.model}) e enviado para pendentes/`,
          statement_hash: stmtHash,
          statement_changed: false,
          pending_github_folder: pendingPaths.folderPath,
          pending_github_paths: published.paths,
          pending_commit_sha: published.commitSha,
          pending_html_url: published.htmlUrl,
          pending_folder_url: published.folderUrl,
          provider: generated.provider,
          model: generated.model,
          estimated_cost_usd: estimatedCostUsd,
          last_error: null,
          updated_at: finishedAt,
        },
      },
      { upsert: true }
    ),
    db.collection('puc_jobs').updateOne(
      { job_id: jobId },
      {
        $set: {
          status: 'completed' as PucJobStatus,
          stage: 'Enviado a verificar',
          progress: 100,
          error: null,
          finished_at: finishedAt,
          updated_at: finishedAt,
          telemetry: {
            duration_ms: Date.now() - startedMs,
            provider: generated.provider,
            model: generated.model,
            estimated_cost_usd: estimatedCostUsd,
            input_chars: totalInputChars,
            output_chars: totalOutputChars,
            completeness_retried: completenessRetried,
            vision_pages_used: visionPages.length,
          },
        },
      }
    ),
  ]);

  // Etapa 6: Enviar Web Push "[SIGLA] a verificar"
  const push = buildAgentNotificationPayload({
    kind: 'a_verificar',
    courseAcronym: job.course_acronym,
    courseId: cid,
    assignmentId: aid,
    assignmentName,
    description: assignment.description ?? null,
    dueAt: assignment.due_at ?? null,
    questionsTotal: understanding.questions.total,
    questionsOpen: understanding.questions.open,
    hasCrossword: understanding.questions.hasCrosswordOrGrid,
  });
  await sendOwnerPush(push);
}

async function processNextQueuedJob(db: Db): Promise<boolean> {
  const config = await getPucAgentConfig(db);
  if (config.paused) return false;

  const jobsCol = db.collection<PucJobDoc>('puc_jobs');
  const now = new Date();
  const claimed = await jobsCol.findOneAndUpdate(
    { status: 'queued' },
    {
      $set: {
        status: 'running' as PucJobStatus,
        stage: 'Iniciando job',
        progress: 5,
        started_at: now,
        updated_at: now,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { priority_due_at: 1, created_at: 1 },
      returnDocument: 'after',
    }
  );

  if (!claimed) return false;
  cancelledJobIds.delete(claimed.job_id);

  try {
    await executeSingleAgentJob(db, claimed);
  } catch (err: any) {
    if (err?.isCancelled || cancelledJobIds.has(claimed.job_id)) {
      return true;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const failedAt = new Date();
    const canAutoRetry = claimed.attempts < claimed.max_attempts;

    if (canAutoRetry) {
      await jobsCol.updateOne(
        { job_id: claimed.job_id },
        {
          $set: {
            status: 'queued' as PucJobStatus,
            stage: `Erro temporário — nova tentativa (${claimed.attempts}/${claimed.max_attempts})`,
            error: errMsg.slice(0, 500),
            updated_at: failedAt,
          },
        }
      );
    } else {
      await Promise.all([
        jobsCol.updateOne(
          { job_id: claimed.job_id },
          {
            $set: {
              status: 'failed' as PucJobStatus,
              stage: 'Falhou',
              error: errMsg.slice(0, 500),
              finished_at: failedAt,
              updated_at: failedAt,
            },
          }
        ),
        db.collection('puc_agent_records').updateOne(
          { course_id: claimed.course_id, assignment_id: claimed.assignment_id },
          {
            $set: {
              status: 'erro' as AgentRecordStatus,
              decision_reason: `Erro ao gerar: ${errMsg.slice(0, 240)}`,
              last_error: errMsg.slice(0, 500),
              updated_at: failedAt,
            },
          },
          { upsert: true }
        ),
      ]);
    }
  }

  return true;
}

export function kickPucAgentWorker(db: Db): void {
  if (workerRunning) {
    workerKickPending = true;
    return;
  }
  workerRunning = true;
  void (async () => {
    try {
      do {
        workerKickPending = false;
        while (await processNextQueuedJob(db)) {
          // processa fila sequencialmente (protege RAM no Render free)
        }
      } while (workerKickPending);
    } catch (err) {
      console.error('[puc/agent/worker] erro no loop:', err instanceof Error ? err.message : String(err));
    } finally {
      workerRunning = false;
    }
  })();
}

export function startPucAgentWorker(getDbFn: () => Promise<Db>): void {
  if (workerInterval) return;
  // Verifica a cada 60s se há jobs pendentes (ex.: após reinício do servidor)
  workerInterval = setInterval(() => {
    getDbFn()
      .then((db) => kickPucAgentWorker(db))
      .catch(() => undefined);
  }, 60_000);
}
