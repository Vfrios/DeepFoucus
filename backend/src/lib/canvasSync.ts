import type { Db } from 'mongodb';
import pLimit from 'p-limit';
import {
  CanvasApiError,
  CanvasFileApi,
  CanvasModuleApi,
  getCanvasBaseUrl,
  getCanvasFileMeta,
  getCoursePage,
  listActiveCourses,
  listCourseAnnouncements,
  listCourseAssignments,
  listCourseFiles,
  listCourseFolders,
  listCourseModules,
  listCourseOwnGroups,
  listCoursePages,
  listGroupUsers,
} from './canvasApi';
import {
  AssignmentRecord,
  classifyAssignmentsForCourse,
  detectGradedPartUnlock,
  extractCourseLessonsFromAssignments,
  GradedPartNotification,
  MultiPartProjectSpec,
} from './pucAssistantCore';
import { getGithubConfigStatus } from './pucGithub';
import {
  computeDaysRemaining,
  getCanvasToken,
  markCanvasToken401,
  maybeSendCanvasTokenPush,
} from './canvasAuth';
import {
  classifyDeliveryStatus,
  formatSaoPauloDateTime,
  generateAutoAliases,
} from './canvasUtils';
import { sendPushToAll, sendPushToUser } from '../routes/push';

const MAX_CONCURRENT_REQUESTS = 5;

export type CanvasSyncMode = 'light' | 'full';

export interface CanvasSyncProgress {
  running: boolean;
  mode: CanvasSyncMode | null;
  stage: string | null;
  currentCourse: string | null;
  completedCourses: number;
  totalCourses: number;
  startedAt: string | null;
}

export interface StageTimings {
  courses: number;
  assignments: number;
  announcements: number;
  pages: number;
  modules: number;
  files: number;
  total: number;
}

export interface SyncResult {
  ok: boolean;
  mode?: CanvasSyncMode;
  skipped?: boolean;
  reason?: string;
  coursesDiscovered?: number;
  coursesSynced?: number;
  coursesHidden?: number;
  durationMs?: number;
  timingsMs?: StageTimings;
  pagesFetchedBodies?: number;
  pagesSkippedUnchanged?: number;
  changesDetected?: number;
  warnings?: string[];
  error?: string;
}

let syncInProgress = false;
let syncProgress: CanvasSyncProgress = {
  running: false,
  mode: null,
  stage: null,
  currentCourse: null,
  completedCourses: 0,
  totalCourses: 0,
  startedAt: null,
};

export function isCanvasSyncRunning(): boolean {
  return syncInProgress;
}

export function getCanvasSyncProgress(): CanvasSyncProgress {
  return { ...syncProgress };
}

function normalizeFolderFullName(fullName?: string): string {
  if (!fullName) return 'Raiz';
  const cleaned = fullName.replace(/^course files\/?/i, '').replace(/^\/+|\/+$/g, '').trim();
  return cleaned || 'Raiz';
}

function isIgnorableResourceError(err: unknown): boolean {
  return err instanceof CanvasApiError && (err.status === 403 || err.status === 404);
}

interface ChangeEvent {
  kind: 'new_assignment' | 'due_changed' | 'grade_posted';
  courseName: string;
  assignmentName: string;
  detail?: string;
}

async function sendGroupedChangesPush(changes: ChangeEvent[]): Promise<void> {
  if (changes.length === 0) return;

  const newCount = changes.filter((c) => c.kind === 'new_assignment').length;
  const dueCount = changes.filter((c) => c.kind === 'due_changed').length;
  const gradeCount = changes.filter((c) => c.kind === 'grade_posted').length;

  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} trabalho(s) novo(s)`);
  if (dueCount > 0) parts.push(`${dueCount} prazo(s) alterado(s)`);
  if (gradeCount > 0) parts.push(`${gradeCount} nota(s) lançada(s)`);

  const preview = changes
    .slice(0, 3)
    .map((c) => `${c.courseName}: ${c.assignmentName}${c.detail ? ` (${c.detail})` : ''}`)
    .join(' · ');

  const payload = {
    title: `PUC: ${parts.join(', ')}`,
    body: preview,
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
      await sendPushToAll(payload);
    }
  } catch (err) {
    console.error('[puc/push] erro ao enviar resumo de novidades:', err instanceof Error ? err.message : String(err));
  }
}

async function sendGradedPartNotifications(notifications: GradedPartNotification[]): Promise<void> {
  if (notifications.length === 0) return;
  const ownerEmail = (process.env.EMAIL_VITOR || '').trim();

  for (const n of notifications) {
    const payload = {
      title: n.title,
      body: n.body,
      url: `/?page=puc&courseId=${n.courseId}&assignmentId=${n.nextAssignmentId}`,
    };
    try {
      let sent = 0;
      if (ownerEmail) {
        const res = await sendPushToUser(ownerEmail, payload);
        sent = res.sent;
      }
      if (sent === 0) {
        await sendPushToAll(payload);
      }
    } catch (err) {
      console.error('[puc/push] erro ao enviar aviso de parte corrigida:', err instanceof Error ? err.message : String(err));
    }
  }
}

async function syncSingleCourse(
  db: Db,
  course: any,
  mode: CanvasSyncMode,
  token: string,
  limit: ReturnType<typeof pLimit>,
  onUnauthorized: () => Promise<void>,
  warnings: string[],
  timings: StageTimings,
  changes: ChangeEvent[],
  gradedPartNotifications: GradedPartNotification[],
  hadPreviousSync: boolean,
  pageStats: { fetched: number; skipped: number }
): Promise<void> {
  const courseId = Number(course.canvas_id);
  const courseName = String(course.name || `Curso ${courseId}`);
  const now = new Date();
  const baseUrl = getCanvasBaseUrl();
  const opts = { onUnauthorized };

  const courseCountsPatch: Record<string, unknown> = {
    last_synced_at: now,
  };
  let courseHasGrades = Boolean(
    typeof course.current_score === 'number' || typeof course.final_score === 'number'
  );

  // ---- 1. Trabalhos (Assignments + submission) — sempre no modo leve e completo ----
  const tAssignments = Date.now();
  syncProgress = { ...syncProgress, currentCourse: courseName, stage: 'Trabalhos' };
  try {
    const col = db.collection('canvas_assignments');
    const [assignments, existingDocs, existingProjects] = await Promise.all([
      limit(() => listCourseAssignments(courseId, token, opts)),
      col
        .find(
          { course_id: courseId },
          {
            projection: {
              canvas_id: 1,
              due_at: 1,
              score: 1,
              grade: 1,
              workflow_state: 1,
              submitted_at: 1,
              name: 1,
              assignment_kind: 1,
              assignment_kind_manual: 1,
              project_id: 1,
            },
          }
        )
        .toArray(),
      db.collection('puc_projects').find({ course_id: courseId }).toArray(),
    ]);

    const prevMap = new Map<number, any>(existingDocs.map((d) => [Number(d.canvas_id), d]));
    const seenIds: number[] = [];
    let gradedCount = 0;
    let pointsAssignmentsCount = 0;

    if (assignments.length > 0) {
      await col.bulkWrite(
        assignments.map((a) => {
          seenIds.push(a.id);
          const sub = a.submission || null;
          const dueAt = a.due_at ? new Date(a.due_at) : null;
          const lockAt = a.lock_at ? new Date(a.lock_at) : null;
          const submittedAt = sub?.submitted_at ? new Date(sub.submitted_at) : null;
          const score = typeof sub?.score === 'number' ? sub.score : null;
          const grade = typeof sub?.grade === 'string' && sub.grade.trim() ? sub.grade.trim() : null;
          const workflowState = sub?.workflow_state ?? 'unsubmitted';
          const late = Boolean(sub?.late);
          const missing = Boolean(sub?.missing);
          const excused = Boolean(sub?.excused);
          const submissionTypes = Array.isArray(a.submission_types) ? a.submission_types : [];
          if (typeof a.points_possible === 'number' && a.points_possible > 0) {
            pointsAssignmentsCount += 1;
          }
          if (score !== null || grade !== null || workflowState === 'graded') {
            gradedCount += 1;
          }
          const deliveryStatus = classifyDeliveryStatus(
            {
              due_at: dueAt,
              lock_at: lockAt,
              locked_for_user: Boolean(a.locked_for_user),
              points_possible: typeof a.points_possible === 'number' ? a.points_possible : null,
              submission_types: submissionTypes,
              workflow_state: workflowState,
              submitted_at: submittedAt,
              score,
              grade,
              late,
              missing,
              excused,
            },
            now
          );

          // Comparação para Extra #1 (push agrupado de novidades)
          if (hadPreviousSync) {
            const prev = prevMap.get(a.id);
            if (!prev) {
              changes.push({
                kind: 'new_assignment',
                courseName,
                assignmentName: a.name || '(sem título)',
                detail: dueAt ? `prazo ${formatSaoPauloDateTime(dueAt)}` : undefined,
              });
            } else {
              const prevDueMs = prev.due_at ? new Date(prev.due_at).getTime() : null;
              const nextDueMs = dueAt ? dueAt.getTime() : null;
              if (prevDueMs !== nextDueMs && nextDueMs !== null) {
                changes.push({
                  kind: 'due_changed',
                  courseName,
                  assignmentName: a.name || '(sem título)',
                  detail: `novo prazo ${formatSaoPauloDateTime(dueAt)}`,
                });
              }
              const prevScore = typeof prev.score === 'number' ? prev.score : null;
              const prevGrade = prev.grade ?? null;
              if ((score !== null && score !== prevScore) || (grade !== null && grade !== prevGrade)) {
                changes.push({
                  kind: 'grade_posted',
                  courseName,
                  assignmentName: a.name || '(sem título)',
                  detail:
                    score !== null && typeof a.points_possible === 'number'
                      ? `${score}/${a.points_possible}`
                      : grade || String(score),
                });
              }
            }
          }

          const attachments = Array.isArray(sub?.attachments)
            ? sub.attachments.map((att) => ({
                id: att.id ?? null,
                display_name: att.display_name || att.filename || 'anexo',
                size: typeof att.size === 'number' ? att.size : 0,
                content_type: att['content-type'] || 'application/octet-stream',
              }))
            : [];

          const rubric = Array.isArray(a.rubric)
            ? a.rubric.map((crit) => ({
                id: crit.id ?? null,
                description: crit.description || '',
                long_description: crit.long_description || '',
                points: typeof crit.points === 'number' ? crit.points : 0,
              }))
            : [];

          const submissionComments = Array.isArray(sub?.submission_comments)
            ? sub.submission_comments.map((cmt) => ({
                id: cmt.id ?? null,
                author_name: cmt.author_name ?? null,
                comment: cmt.comment ?? '',
                created_at: cmt.created_at ? new Date(cmt.created_at) : null,
              }))
            : [];

          const rubricAssessment =
            sub?.rubric_assessment && typeof sub.rubric_assessment === 'object'
              ? sub.rubric_assessment
              : null;

          return {
            updateOne: {
              filter: { course_id: courseId, canvas_id: a.id },
              update: {
                $set: {
                  course_id: courseId,
                  course_name: courseName,
                  canvas_id: a.id,
                  name: a.name || '(sem título)',
                  description: a.description ?? null,
                  due_at: dueAt,
                  lock_at: lockAt,
                  locked_for_user: Boolean(a.locked_for_user),
                  points_possible: typeof a.points_possible === 'number' ? a.points_possible : null,
                  html_url: a.html_url || `${baseUrl}/courses/${courseId}/assignments/${a.id}`,
                  submission_types: submissionTypes,
                  group_category_id: typeof a.group_category_id === 'number' ? a.group_category_id : null,
                  workflow_state: workflowState,
                  submitted_at: submittedAt,
                  submission_body: typeof sub?.body === 'string' ? sub.body : null,
                  score,
                  grade,
                  late,
                  missing,
                  excused,
                  delivery_status: deliveryStatus,
                  attachments,
                  rubric,
                  submission_comments: submissionComments,
                  rubric_assessment: rubricAssessment,
                  updated_at: a.updated_at ? new Date(a.updated_at) : null,
                  synced_at: now,
                },
              },
              upsert: true,
            },
          };
        })
      );
    }
    await col.deleteMany({ course_id: courseId, canvas_id: { $nin: seenIds } });

    // Classificação multi_part vs one_shot + projetos + Lições do professor + detecção de parte corrigida
    const syncedAssignmentDocs = (await col.find({ course_id: courseId }).toArray()) as unknown as AssignmentRecord[];
    const classification = classifyAssignmentsForCourse(
      courseId,
      courseName,
      syncedAssignmentDocs,
      existingProjects as unknown as MultiPartProjectSpec[]
    );

    if (syncedAssignmentDocs.length > 0) {
      await col.bulkWrite(
        syncedAssignmentDocs.map((doc) => {
          const cls = classification.classifications.get(doc.canvas_id);
          return {
            updateOne: {
              filter: { course_id: courseId, canvas_id: doc.canvas_id },
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

    const projectsCol = db.collection('puc_projects');
    const activeProjectIds = classification.projects.map((p) => p.project_id);
    if (classification.projects.length > 0) {
      await projectsCol.bulkWrite(
        classification.projects.map((proj) => ({
          updateOne: {
            filter: { course_id: courseId, project_id: proj.project_id },
            update: {
              $set: {
                course_id: courseId,
                course_name: courseName,
                project_id: proj.project_id,
                title: proj.title,
                manual: Boolean(proj.manual),
                parts: proj.parts,
                updated_at: now,
              },
              $setOnInsert: {
                created_at: now,
              },
            },
            upsert: true,
          },
        }))
      );
    }
    await projectsCol.deleteMany({ course_id: courseId, project_id: { $nin: activeProjectIds } });

    // Detecção de parte corrigida (apenas multi_part) para Web Push
    if (hadPreviousSync && classification.projects.length > 0) {
      const projectById = new Map(classification.projects.map((p) => [p.project_id, p]));
      for (const doc of syncedAssignmentDocs) {
        const cls = classification.classifications.get(doc.canvas_id);
        const enrichedDoc: AssignmentRecord = {
          ...doc,
          assignment_kind: cls?.assignment_kind ?? 'one_shot',
          project_id: cls?.project_id ?? null,
        };
        const project = enrichedDoc.project_id ? projectById.get(enrichedDoc.project_id) : null;
        const notif = detectGradedPartUnlock({
          prevDoc: prevMap.get(doc.canvas_id),
          nextDoc: enrichedDoc,
          project,
          now,
        });
        if (notif) {
          gradedPartNotifications.push(notif);
        }
      }
    }

    // Atualizar "Lições do professor" por curso
    const lessons = extractCourseLessonsFromAssignments(courseId, courseName, syncedAssignmentDocs, now);
    if (lessons.raw_notes.length > 0 || lessons.recurring_issues.length > 0 || lessons.strengths.length > 0) {
      await db.collection('puc_course_lessons').updateOne(
        { course_id: courseId },
        { $set: lessons },
        { upsert: true }
      );
    }

    // Buscar integrantes do grupo do aluno no curso (melhor esforço, somente leitura)
    try {
      const ownGroups = await limit(() => listCourseOwnGroups(courseId, token, opts));
      if (ownGroups.length > 0) {
        const membersSet = new Set<string>();
        for (const grp of ownGroups.slice(0, 3)) {
          try {
            const users = await limit(() => listGroupUsers(grp.id, token, opts));
            for (const u of users) {
              const nm = (u.name || u.short_name || '').trim();
              if (nm) membersSet.add(nm);
            }
          } catch (gErr) {
            if (gErr instanceof CanvasApiError && gErr.status === 401) throw gErr;
          }
        }
        if (membersSet.size > 0) {
          courseCountsPatch.group_members = Array.from(membersSet);
        }
      }
    } catch (grpErr) {
      if (grpErr instanceof CanvasApiError && grpErr.status === 401) throw grpErr;
    }

    courseCountsPatch.assignments_count = assignments.length;
    courseCountsPatch.graded_count = gradedCount;
    courseCountsPatch.points_assignments_count = pointsAssignmentsCount;
    courseHasGrades =
      courseHasGrades || gradedCount > 0 || pointsAssignmentsCount > 0;
    courseCountsPatch.has_grades = courseHasGrades;
  } catch (err) {
    if (err instanceof CanvasApiError && err.status === 401) throw err;
    if (!isIgnorableResourceError(err)) {
      warnings.push(`Curso ${courseId} (assignments): ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    timings.assignments += Date.now() - tAssignments;
  }

  // ---- 2. Avisos (Announcements) — sempre no modo leve e completo ----
  const tAnnouncements = Date.now();
  syncProgress = { ...syncProgress, currentCourse: courseName, stage: 'Avisos' };
  try {
    const announcements = await limit(() => listCourseAnnouncements(courseId, token, opts));
    const col = db.collection('canvas_announcements');
    const seenIds: number[] = [];
    if (announcements.length > 0) {
      await col.bulkWrite(
        announcements.map((a) => {
          seenIds.push(a.id);
          const posted = a.posted_at || a.created_at;
          return {
            updateOne: {
              filter: { course_id: courseId, canvas_id: a.id },
              update: {
                $set: {
                  course_id: courseId,
                  course_name: courseName,
                  canvas_id: a.id,
                  title: a.title || '(sem título)',
                  message: a.message ?? '',
                  posted_at: posted ? new Date(posted) : null,
                  html_url: a.html_url || `${baseUrl}/courses/${courseId}/discussion_topics/${a.id}`,
                  author_name: a.author?.display_name ?? null,
                  synced_at: now,
                },
                $setOnInsert: {
                  read: false,
                },
              },
              upsert: true,
            },
          };
        })
      );
    }
    await col.deleteMany({ course_id: courseId, canvas_id: { $nin: seenIds } });
    courseCountsPatch.announcements_count = announcements.length;
  } catch (err) {
    if (err instanceof CanvasApiError && err.status === 401) throw err;
    if (!isIgnorableResourceError(err)) {
      warnings.push(`Curso ${courseId} (announcements): ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    timings.announcements += Date.now() - tAnnouncements;
  }

  // ---- Modo COMPLETO: Páginas (incremental), Módulos e Arquivos (somente salas com notas/entregas) ----
  if (mode === 'full' && courseHasGrades) {
    // 3. Páginas — busca body apenas se for nova ou updated_at mudou!
    const tPages = Date.now();
    syncProgress = { ...syncProgress, currentCourse: courseName, stage: 'Páginas' };
    try {
      const col = db.collection('canvas_pages');
      const [pagesList, existingPages] = await Promise.all([
        limit(() => listCoursePages(courseId, token, opts)),
        col
          .find({ course_id: courseId }, { projection: { slug: 1, updated_at: 1, body: 1 } })
          .toArray(),
      ]);

      const existingMap = new Map<string, { updatedAtMs: number | null; hasBody: boolean }>(
        existingPages.map((p) => [
          String(p.slug),
          {
            updatedAtMs: p.updated_at ? new Date(p.updated_at).getTime() : null,
            hasBody: typeof p.body === 'string' && p.body.length > 0,
          },
        ])
      );

      const seenSlugs: string[] = [];
      const toFetch = pagesList.filter((p) => {
        seenSlugs.push(p.url);
        const existing = existingMap.get(p.url);
        if (!existing || !existing.hasBody) return true;
        const remoteMs = p.updated_at ? new Date(p.updated_at).getTime() : null;
        return remoteMs === null || existing.updatedAtMs !== remoteMs;
      });

      pageStats.skipped += pagesList.length - toFetch.length;

      const fetchedMap = new Map<string, string>();
      await Promise.all(
        toFetch.map((p) =>
          limit(async () => {
            try {
              const detail = await getCoursePage(courseId, p.url, token, opts);
              fetchedMap.set(p.url, detail.body ?? '');
              pageStats.fetched += 1;
            } catch (err) {
              if (err instanceof CanvasApiError && err.status === 401) throw err;
            }
          })
        )
      );

      if (pagesList.length > 0) {
        await col.bulkWrite(
          pagesList.map((p) => {
            const setFields: Record<string, unknown> = {
              course_id: courseId,
              slug: p.url,
              page_id: p.page_id ?? null,
              title: p.title || p.url,
              html_url: p.html_url || `${baseUrl}/courses/${courseId}/pages/${encodeURIComponent(p.url)}`,
              updated_at: p.updated_at ? new Date(p.updated_at) : null,
              published: p.published !== false,
              synced_at: now,
            };
            if (fetchedMap.has(p.url)) {
              setFields.body = fetchedMap.get(p.url);
            }
            return {
              updateOne: {
                filter: { course_id: courseId, slug: p.url },
                update: { $set: setFields },
                upsert: true,
              },
            };
          })
        );
      }
      await col.deleteMany({ course_id: courseId, slug: { $nin: seenSlugs } });
      courseCountsPatch.pages_count = pagesList.length;
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 401) throw err;
      if (!isIgnorableResourceError(err)) {
        warnings.push(`Curso ${courseId} (pages): ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      timings.pages += Date.now() - tPages;
    }

    // 4. Módulos
    const tModules = Date.now();
    syncProgress = { ...syncProgress, currentCourse: courseName, stage: 'Módulos' };
    let modules: CanvasModuleApi[] = [];
    try {
      modules = await limit(() => listCourseModules(courseId, token, opts));
      const col = db.collection('canvas_modules');
      const seenIds: number[] = [];
      if (modules.length > 0) {
        await col.bulkWrite(
          modules.map((m) => {
            seenIds.push(m.id);
            const items = Array.isArray(m.items)
              ? m.items.map((item) => ({
                  id: item.id,
                  title: item.title || '',
                  type: item.type || '',
                  position: item.position ?? 0,
                  content_id: item.content_id ?? null,
                  page_url: item.page_url ?? null,
                  external_url: item.external_url ?? null,
                  html_url: item.html_url ?? null,
                }))
              : [];
            return {
              updateOne: {
                filter: { course_id: courseId, canvas_id: m.id },
                update: {
                  $set: {
                    course_id: courseId,
                    canvas_id: m.id,
                    name: m.name || 'Módulo',
                    position: m.position ?? 0,
                    items,
                    synced_at: now,
                  },
                },
                upsert: true,
              },
            };
          })
        );
      }
      await col.deleteMany({ course_id: courseId, canvas_id: { $nin: seenIds } });
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 401) throw err;
      if (!isIgnorableResourceError(err)) {
        warnings.push(`Curso ${courseId} (modules): ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      timings.modules += Date.now() - tModules;
    }

    // 5. Arquivos:
    // - /folders serve APENAS para mapear folder_id -> nome da pasta (sem varrer /folders/:id/files)
    // - /courses/:cid/files já devolve todos os arquivos do curso
    // - /files/:id é chamado APENAS para arquivos citados em módulos que não vieram na listagem
    const tFiles = Date.now();
    syncProgress = { ...syncProgress, currentCourse: courseName, stage: 'Arquivos' };
    try {
      const folderPathById = new Map<number, string>();
      try {
        const folders = await limit(() => listCourseFolders(courseId, token, opts));
        for (const folder of folders) {
          folderPathById.set(folder.id, normalizeFolderFullName(folder.full_name || folder.name));
        }
      } catch (err) {
        if (err instanceof CanvasApiError && err.status === 401) throw err;
        if (!isIgnorableResourceError(err)) {
          warnings.push(`Curso ${courseId} (folders): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const filesMap = new Map<number, { file: CanvasFileApi; originPath: string }>();
      try {
        const courseFiles = await limit(() => listCourseFiles(courseId, token, opts));
        for (const f of courseFiles) {
          if (typeof f.id !== 'number' || filesMap.has(f.id)) continue;
          const originPath = (f.folder_id && folderPathById.get(f.folder_id)) || 'Raiz';
          filesMap.set(f.id, { file: f, originPath });
        }
      } catch (err) {
        if (err instanceof CanvasApiError && err.status === 401) throw err;
        if (!isIgnorableResourceError(err)) {
          warnings.push(`Curso ${courseId} (files): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Somente arquivos de módulo cujo content_id não veio na listagem /courses/:cid/files
      const missingModuleRefs: Array<{ contentId: number; moduleName: string }> = [];
      for (const m of modules) {
        if (!Array.isArray(m.items)) continue;
        for (const item of m.items) {
          if (
            item.type === 'File' &&
            typeof item.content_id === 'number' &&
            !filesMap.has(item.content_id)
          ) {
            missingModuleRefs.push({ contentId: item.content_id, moduleName: m.name || 'Módulos' });
          }
        }
      }

      const uniqueMissing = Array.from(
        new Map(missingModuleRefs.map((ref) => [ref.contentId, ref])).values()
      );
      await Promise.all(
        uniqueMissing.map((ref) =>
          limit(async () => {
            if (filesMap.has(ref.contentId)) return;
            try {
              const meta = await getCanvasFileMeta(ref.contentId, token, opts);
              if (typeof meta.id === 'number' && !filesMap.has(meta.id)) {
                const originPath =
                  (meta.folder_id && folderPathById.get(meta.folder_id)) ||
                  ref.moduleName ||
                  'Módulos';
                filesMap.set(meta.id, { file: meta, originPath });
              }
            } catch (err) {
              if (err instanceof CanvasApiError && err.status === 401) throw err;
            }
          })
        )
      );

      const col = db.collection('canvas_files');
      const entries = Array.from(filesMap.values());
      const seenIds: number[] = [];
      if (entries.length > 0) {
        await col.bulkWrite(
          entries.map(({ file, originPath }) => {
            seenIds.push(file.id);
            const contentType = file['content-type'] || file.content_type || 'application/octet-stream';
            const displayName = file.display_name || file.filename || `arquivo-${file.id}`;
            return {
              updateOne: {
                filter: { course_id: courseId, canvas_id: file.id },
                update: {
                  $set: {
                    course_id: courseId,
                    canvas_id: file.id,
                    folder_id: file.folder_id ?? null,
                    origin_path: originPath,
                    display_name: displayName,
                    filename: file.filename || displayName,
                    size: typeof file.size === 'number' ? file.size : 0,
                    content_type: contentType,
                    updated_at: file.updated_at ? new Date(file.updated_at) : null,
                    html_url: file.html_url || `${baseUrl}/courses/${courseId}/files/${file.id}`,
                    synced_at: now,
                  },
                  $unset: { url: '' },
                },
                upsert: true,
              },
            };
          })
        );
      }
      await col.deleteMany({ course_id: courseId, canvas_id: { $nin: seenIds } });
      courseCountsPatch.files_count = entries.length;
      courseCountsPatch.last_full_synced_at = now;
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 401) throw err;
      warnings.push(`Curso ${courseId} (salvar arquivos): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      timings.files += Date.now() - tFiles;
    }
  }

  await db.collection('canvas_courses').updateOne(
    { canvas_id: courseId },
    { $set: courseCountsPatch }
  );
}

/**
 * Sincroniza dados do Canvas no MongoDB.
 * - `mode = 'light'` (padrão): cursos, trabalhos (com submission) e avisos.
 * - `mode = 'full'`: tudo do leve + páginas (incrementais por updated_at), módulos e arquivos.
 */
export async function syncAgora(db: Db, mode: CanvasSyncMode = 'light'): Promise<SyncResult> {
  if (syncInProgress) {
    return { ok: false, mode, skipped: true, reason: 'sync_already_running' };
  }

  syncInProgress = true;
  const startedAt = new Date();
  const warnings: string[] = [];
  const changes: ChangeEvent[] = [];
  const gradedPartNotifications: GradedPartNotification[] = [];
  const pageStats = { fetched: 0, skipped: 0 };
  const timings: StageTimings = {
    courses: 0,
    assignments: 0,
    announcements: 0,
    pages: 0,
    modules: 0,
    files: 0,
    total: 0,
  };

  syncProgress = {
    running: true,
    mode,
    stage: 'Validando token',
    currentCourse: null,
    completedCourses: 0,
    totalCourses: 0,
    startedAt: startedAt.toISOString(),
  };

  try {
    const auth = await getCanvasToken(db);
    if (!auth.doc) {
      return { ok: false, mode, skipped: true, reason: 'token_not_configured' };
    }
    if (auth.decryptError || !auth.token) {
      const finishedAt = new Date();
      await db.collection('canvas_sync_log').insertOne({
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        mode,
        status: 'error',
        error: 'Não foi possível descriptografar o token salvo (verifique ENCRYPTION_KEY).',
      });
      return { ok: false, mode, error: 'token_decrypt_failed' };
    }

    const expiresAt = auth.doc.expires_at instanceof Date ? auth.doc.expires_at : new Date(auth.doc.expires_at);
    const daysRemaining = computeDaysRemaining(expiresAt, startedAt);
    if (daysRemaining <= 5 && daysRemaining > 0) {
      await maybeSendCanvasTokenPush(db, 'expiring', daysRemaining);
    }
    // Verifica também se o token do GitHub está a <= 7 dias de expirar (envia push no máx. 1x/dia)
    await getGithubConfigStatus(db, startedAt, true).catch(() => undefined);

    let unauthorizedHandled = false;
    const onUnauthorized = async () => {
      if (unauthorizedHandled) return;
      unauthorizedHandled = true;
      await markCanvasToken401(db);
    };

    const hadPreviousSync = Boolean(
      await db.collection('canvas_sync_log').findOne({ status: { $in: ['ok', 'partial'] } })
    );

    // 1. Descobrir cursos
    const tCourses = Date.now();
    syncProgress = { ...syncProgress, stage: 'Listando cursos' };
    const rawCourses = await listActiveCourses(auth.token, { onUnauthorized });
    timings.courses = Date.now() - tCourses;

    const validCourses = rawCourses.filter(
      (c) => typeof c.id === 'number' && !c.access_restricted_by_date && Boolean(c.name || c.course_code)
    );

    const coursesCol = db.collection('canvas_courses');
    const activeIds: number[] = [];

    if (validCourses.length > 0) {
      await coursesCol.bulkWrite(
        validCourses.map((c) => {
          activeIds.push(c.id);
          const name = c.name || c.course_code || `Curso ${c.id}`;
          const code = c.course_code || '';
          const autoAliases = generateAutoAliases(name, code);
          const enr = Array.isArray(c.enrollments) ? c.enrollments[0] : undefined;
          const currentScore =
            typeof enr?.computed_current_score === 'number' ? enr.computed_current_score : null;
          const finalScore =
            typeof enr?.computed_final_score === 'number' ? enr.computed_final_score : null;
          const hasScoresFromEnrollment = currentScore !== null || finalScore !== null;
          return {
            updateOne: {
              filter: { canvas_id: c.id },
              update: {
                $set: {
                  canvas_id: c.id,
                  name,
                  course_code: code,
                  auto_aliases: autoAliases,
                  current_score: currentScore,
                  final_score: finalScore,
                  has_grades: hasScoresFromEnrollment,
                  term_id: c.term?.id ?? c.enrollment_term_id ?? null,
                  term_name: c.term?.name || 'Sem semestre',
                  term_start_at: c.term?.start_at ? new Date(c.term.start_at) : null,
                  workflow_state: c.workflow_state || 'available',
                  active: true,
                  updated_at: startedAt,
                },
                $setOnInsert: {
                  hidden: false,
                  ai_allowed: true,
                  aliases: [],
                  group_members: [],
                  files_count: 0,
                  assignments_count: 0,
                  graded_count: 0,
                  points_assignments_count: 0,
                  announcements_count: 0,
                  pages_count: 0,
                },
              },
              upsert: true,
            },
          };
        })
      );
    }

    await coursesCol.updateMany(
      { canvas_id: { $nin: activeIds } },
      { $set: { active: false } }
    );

    const storedCourses = await coursesCol.find({ canvas_id: { $in: activeIds } }).toArray();
    const visibleCourses = storedCourses.filter((c) => !c.hidden);
    const hiddenCount = storedCourses.length - visibleCourses.length;

    syncProgress = {
      ...syncProgress,
      totalCourses: visibleCourses.length,
      completedCourses: 0,
      stage: 'Sincronizando cursos',
    };

    const limit = pLimit(MAX_CONCURRENT_REQUESTS);

    await Promise.all(
      visibleCourses.map(async (course) => {
        await syncSingleCourse(
          db,
          course,
          mode,
          auth.token!,
          limit,
          onUnauthorized,
          warnings,
          timings,
          changes,
          gradedPartNotifications,
          hadPreviousSync,
          pageStats
        );
        syncProgress = {
          ...syncProgress,
          completedCourses: syncProgress.completedCourses + 1,
        };
      })
    );

    if (changes.length > 0) {
      await sendGroupedChangesPush(changes);
    }
    if (gradedPartNotifications.length > 0) {
      await sendGradedPartNotifications(gradedPartNotifications);
    }

    const finishedAt = new Date();
    timings.total = finishedAt.getTime() - startedAt.getTime();
    const status = warnings.length > 0 ? 'partial' : 'ok';

    await db.collection('canvas_sync_log').insertOne({
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: timings.total,
      mode,
      status,
      courses_discovered: validCourses.length,
      courses_synced: visibleCourses.length,
      courses_hidden: hiddenCount,
      timings_ms: timings,
      pages_fetched_bodies: pageStats.fetched,
      pages_skipped_unchanged: pageStats.skipped,
      changes_detected: changes.length,
      warnings: warnings.slice(0, 50),
      error: null,
    });

    return {
      ok: true,
      mode,
      coursesDiscovered: validCourses.length,
      coursesSynced: visibleCourses.length,
      coursesHidden: hiddenCount,
      durationMs: timings.total,
      timingsMs: timings,
      pagesFetchedBodies: pageStats.fetched,
      pagesSkippedUnchanged: pageStats.skipped,
      changesDetected: changes.length,
      warnings,
    };
  } catch (err) {
    const finishedAt = new Date();
    timings.total = finishedAt.getTime() - startedAt.getTime();
    const message = err instanceof Error ? err.message : String(err);

    await db.collection('canvas_sync_log').insertOne({
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: timings.total,
      mode,
      status: 'error',
      timings_ms: timings,
      error: message,
      warnings: warnings.slice(0, 50),
    });

    return { ok: false, mode, durationMs: timings.total, timingsMs: timings, error: message, warnings };
  } finally {
    syncInProgress = false;
    syncProgress = {
      running: false,
      mode: null,
      stage: null,
      currentCourse: null,
      completedCourses: 0,
      totalCourses: 0,
      startedAt: null,
    };
  }
}
