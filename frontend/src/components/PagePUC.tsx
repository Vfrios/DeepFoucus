import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useDevice } from '../device/useDevice';
import { api } from '../lib/api';
import {
  DeliveryStatus,
  formatDurationMs,
  formatSaoPauloDateTime,
  isDueTodaySaoPaulo,
  isDueWithinDaysSaoPaulo,
  sanitizeCanvasHtml,
  statusBadgeInfo,
} from '../lib/canvasHtml';
import PucWorkAssistantModal, { DeliverableStatus } from './PucWorkAssistantModal';
import PucGithubConfigPanel, { GithubConfigStatus } from './PucGithubConfigPanel';
import PucAgentPanel from './PucAgentPanel';

interface TokenStatus {
  configured: boolean;
  decryptError?: boolean;
  savedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  expiringSoon: boolean;
  expired: boolean;
  expired401: boolean;
  canvasUserName: string | null;
}

interface SyncProgress {
  running: boolean;
  mode: 'light' | 'full' | null;
  stage: string | null;
  currentCourse: string | null;
  completedCourses: number;
  totalCourses: number;
  startedAt: string | null;
}

interface GlobalSummary {
  pending: number;
  overdue: number;
  submitted: number;
  graded: number;
  dueToday: number;
  dueThisWeek: number;
  unreadAnnouncements: number;
  awaitingReview?: number;
  readyToSubmit?: number;
}

interface LastSyncInfo {
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  mode: 'light' | 'full';
  status: 'ok' | 'partial' | 'error';
  coursesDiscovered: number | null;
  coursesSynced: number | null;
  coursesHidden: number | null;
  error: string | null;
  warningsCount: number;
}

interface PucStatusResponse {
  token: TokenStatus;
  syncing: boolean;
  progress: SyncProgress;
  summary: GlobalSummary;
  lastSync: LastSyncInfo | null;
}

interface PucCourse {
  id: number;
  name: string;
  courseCode: string;
  termId: number | null;
  termName: string;
  termStartAt: string | null;
  hidden: boolean;
  aiAllowed?: boolean;
  groupMembers?: string[];
  aliases: string[];
  autoAliases: string[];
  filesCount: number;
  assignmentsCount: number;
  announcementsCount: number;
  pagesCount: number;
  lastSyncedAt: string | null;
}

interface AssignmentAttachment {
  id: number | null;
  display_name: string;
  size: number;
  content_type: string;
}

interface RubricCriterion {
  id: string | null;
  description: string;
  long_description: string;
  points: number;
}

interface PucAssignment {
  id: number;
  courseId: number;
  courseName?: string;
  name: string;
  description?: string | null;
  dueAt: string | null;
  lockAt?: string | null;
  lockedForUser?: boolean;
  pointsPossible: number | null;
  htmlUrl: string | null;
  submissionTypes: string[];
  workflowState: string;
  submittedAt: string | null;
  score: number | null;
  grade: string | null;
  late: boolean;
  missing: boolean;
  excused: boolean;
  deliveryStatus: DeliveryStatus;
  attachments?: AssignmentAttachment[];
  rubric?: RubricCriterion[];
  assignmentKind?: 'multi_part' | 'one_shot';
  projectId?: string | null;
  partOrder?: number | null;
  dependsOn?: number | null;
  deliverableStatus?: DeliverableStatus | null;
  readyToSubmit?: boolean;
  isHandwritten?: boolean;
  githubUrl?: string | null;
  hasPendingGithub?: boolean;
  statementChanged?: boolean;
  pendingPlaceholdersCount?: number;
}

interface ReadyToSubmitItem {
  courseId: number;
  courseName: string;
  assignmentId: number;
  assignmentName: string;
  githubUrl: string | null;
  version: number | null;
  dueAt: string | null;
  htmlUrl: string | null;
}

function getDeliverableBadge(status: DeliverableStatus): { label: string; tone: string } {
  if (status === 'entrega_gerada') return { label: 'No GitHub (verificado)', tone: 'ok' };
  if (status === 'validada') return { label: 'Verificado', tone: 'accent' };
  if (status === 'enviado_a_verificar') return { label: 'Enviado a verificar', tone: 'accent' };
  if (status === 'revisada_por_mim') return { label: 'Revisada por mim', tone: 'warm' };
  return { label: 'Rascunho', tone: 'muted' };
}

interface MultiPartProjectSummary {
  projectId: string;
  courseId: number;
  courseName: string;
  title: string;
  manual: boolean;
  aiAllowed: boolean;
  parts: Array<{
    assignmentId: number;
    name: string;
    order: number;
    dependsOn: number | null;
    dueAt: string | null;
    timelineState: string;
    timelineLabel: string;
    deliverableStatus: DeliverableStatus | null;
    score: number | null;
    pointsPossible: number | null;
  }>;
}

interface AwaitingReviewItem {
  courseId: number;
  courseName: string;
  assignmentId: number;
  assignmentName: string;
  status: DeliverableStatus;
  statusLabel: string;
  pendingPlaceholdersCount: number;
  updatedAt: string | null;
}

interface PucAnnouncement {
  id: number;
  courseId: number;
  courseName?: string;
  title: string;
  message: string;
  postedAt: string | null;
  htmlUrl: string | null;
  authorName: string | null;
  read: boolean;
}

interface PucPageSummary {
  slug: string;
  courseId: number;
  title: string;
  htmlUrl: string | null;
  updatedAt: string | null;
}

interface PucPageDetail extends PucPageSummary {
  body: string;
}

interface PucFile {
  id: number;
  courseId: number;
  displayName: string;
  filename: string;
  originPath: string;
  size: number;
  contentType: string;
  updatedAt: string | null;
  htmlUrl: string | null;
}

interface UpcomingResponse {
  assignments: PucAssignment[];
  announcements: PucAnnouncement[];
}

interface AskItemRef {
  kind: 'assignment' | 'announcement' | 'page' | 'file';
  title: string;
  courseName: string;
  status?: string;
  dueAt?: string | null;
  htmlUrl: string | null;
}

interface ChatEntry {
  id: string;
  question: string;
  answer?: string;
  items?: AskItemRef[];
  error?: string;
  loading?: boolean;
}

type CourseTab = 'assignments' | 'announcements' | 'grades' | 'pages' | 'files';
type AssignmentFilter = 'pending' | 'overdue' | 'submitted' | 'all';
type QuickFilter = null | 'today' | 'week' | 'overdue' | 'pending';

const SUGGESTED_QUESTIONS = [
  'O que falta entregar?',
  'O que vence esta semana?',
  'Quais avisos novos tenho?',
  'Quando é a próxima prova?',
];

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOfflineSrcDoc(title: string, body: string): string {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8" /><title>${safeTitle}</title>
<style>
  body { font-family: 'Segoe UI', Roboto, system-ui, sans-serif; color: #ece6da; background: #141b23; margin: 0; padding: 16px; line-height: 1.6; font-size: 14px; }
  a { color: #86d7c0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #2b3644; padding: 6px 8px; text-align: left; }
  pre, code { background: #1e2733; padding: 2px 5px; border-radius: 4px; }
</style></head><body>${body || '<p><em>Página sem conteúdo.</em></p>'}</body></html>`;
}

function extractApiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // texto simples
  }
  return err.message || fallback;
}

export default function PagePUC() {
  const { view } = useDevice();
  const isMobile = view === 'mobile';

  const [status, setStatus] = useState<PucStatusResponse | null>(null);
  const [courses, setCourses] = useState<PucCourse[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingResponse>({ assignments: [], announcements: [] });
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState('');

  // Token form
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState('');

  // Quick filter at top (Extra #2)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);

  // AI Chat (Req #4)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);

  // Course list, selection & aliases editor
  const [showHidden, setShowHidden] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [mobileShowCourses, setMobileShowCourses] = useState(false);
  const [togglingCourseId, setTogglingCourseId] = useState<number | null>(null);
  const [editingAliasCourseId, setEditingAliasCourseId] = useState<number | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  // Course detail tabs & assignment filter
  const [activeTab, setActiveTab] = useState<CourseTab>('assignments');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState('');
  const [assignments, setAssignments] = useState<PucAssignment[]>([]);
  const [announcements, setAnnouncements] = useState<PucAnnouncement[]>([]);
  const [pages, setPages] = useState<PucPageSummary[]>([]);
  const [files, setFiles] = useState<PucFile[]>([]);
  const [fileSearch, setFileSearch] = useState('');

  // Modals / Bottom sheets
  const [openAssignment, setOpenAssignment] = useState<PucAssignment | null>(null);
  const [openAnnouncement, setOpenAnnouncement] = useState<PucAnnouncement | null>(null);
  const [openPage, setOpenPage] = useState<PucPageDetail | null>(null);
  const [loadingPageSlug, setLoadingPageSlug] = useState<string | null>(null);

  // Assistente de Trabalhos PUC
  const [assistantTarget, setAssistantTarget] = useState<{ courseId: number; assignmentId: number } | null>(null);
  const [courseProjects, setCourseProjects] = useState<MultiPartProjectSummary[]>([]);
  const [allProjects, setAllProjects] = useState<MultiPartProjectSummary[]>([]);
  const [awaitingReviewItems, setAwaitingReviewItems] = useState<AwaitingReviewItem[]>([]);
  const [readyToSubmitItems, setReadyToSubmitItems] = useState<ReadyToSubmitItem[]>([]);
  const [showAwaitingReview, setShowAwaitingReview] = useState(false);
  const [showReadyToSubmit, setShowReadyToSubmit] = useState(false);
  const [togglingAiCourseId, setTogglingAiCourseId] = useState<number | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubConfigStatus | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentBadge, setAgentBadge] = useState<{ enabled: boolean; paused: boolean; activeJobs: number }>({
    enabled: false,
    paused: false,
    activeJobs: 0,
  });

  // Downloads
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  // Envio manual de anexos ao Canvas (somente dono)
  const [submitPanelOpen, setSubmitPanelOpen] = useState(false);
  const [submitFiles, setSubmitFiles] = useState<File[]>([]);
  const [submitComment, setSubmitComment] = useState('');
  const [submittingCanvas, setSubmittingCanvas] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');

  const loadBaseData = useCallback(async () => {
    setInitError('');
    try {
      const [st, cr, up, revSum, projs, ghCfg] = await Promise.all([
        api<PucStatusResponse>('/puc/status'),
        api<PucCourse[]>('/puc/courses'),
        api<UpcomingResponse>('/puc/upcoming'),
        api<{
          awaitingReviewCount: number;
          readyToSubmitCount?: number;
          readyToSubmitItems?: ReadyToSubmitItem[];
          items: AwaitingReviewItem[];
        }>('/puc/assistant/summary').catch(() => ({
          awaitingReviewCount: 0,
          readyToSubmitCount: 0,
          readyToSubmitItems: [],
          items: [],
        })),
        api<MultiPartProjectSummary[]>('/puc/assistant/projects').catch(() => []),
        api<GithubConfigStatus>('/puc/assistant/github/config').catch(() => null),
      ]);
      setStatus(st);
      setSyncing(st.syncing);
      setCourses(cr);
      setUpcoming(up);
      setAwaitingReviewItems(revSum.items || []);
      setReadyToSubmitItems(revSum.readyToSubmitItems || []);
      setAllProjects(projs || []);
      setGithubStatus(ghCfg);
      if (!st.token.configured || st.token.expired || st.token.expiringSoon) {
        setShowTokenForm(true);
      }
      setSelectedCourseId((prev) => {
        if (prev && cr.some((c) => c.id === prev)) return prev;
        const firstVisible = cr.find((c) => !c.hidden);
        return firstVisible ? firstVisible.id : cr[0]?.id ?? null;
      });
    } catch (err) {
      setInitError(extractApiError(err, 'Não foi possível carregar os dados da PUC.'));
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadBaseData();
    // Deep-link via Web Push (/?page=puc&courseId=...&assignmentId=... ou ?tab=agent)
    try {
      const params = new URLSearchParams(window.location.search);
      const cid = Number(params.get('courseId') || '');
      const aid = Number(params.get('assignmentId') || '');
      if (Number.isSafeInteger(cid) && cid > 0 && Number.isSafeInteger(aid) && aid > 0) {
        setSelectedCourseId(cid);
        setAssistantTarget({ courseId: cid, assignmentId: aid });
      } else if (params.get('tab') === 'agent') {
        setAgentOpen(true);
      }
    } catch {
      // ignore
    }
  }, [loadBaseData]);

  // Polling leve do progresso enquanto o sync está em andamento
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => {
      api<PucStatusResponse>('/puc/status')
        .then((st) => {
          setStatus(st);
          if (!st.syncing) {
            setSyncing(false);
            void loadBaseData();
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [syncing, loadBaseData]);

  // Carrega dados da aba ativa do curso selecionado
  useEffect(() => {
    if (!selectedCourseId) return;
    if (isMobile && !mobileShowCourses) return;

    let cancelled = false;
    setTabLoading(true);
    setTabError('');

    const loadTab = async () => {
      try {
        if (activeTab === 'assignments' || activeTab === 'grades') {
          const [data, projs] = await Promise.all([
            api<PucAssignment[]>(`/puc/${selectedCourseId}/assignments`),
            api<MultiPartProjectSummary[]>(`/puc/assistant/projects?courseId=${selectedCourseId}`).catch(() => []),
          ]);
          if (!cancelled) {
            setAssignments(data);
            setCourseProjects(projs);
          }
        } else if (activeTab === 'announcements') {
          const data = await api<PucAnnouncement[]>(`/puc/${selectedCourseId}/announcements`);
          if (!cancelled) setAnnouncements(data);
        } else if (activeTab === 'pages') {
          const data = await api<PucPageSummary[]>(`/puc/${selectedCourseId}/pages`);
          if (!cancelled) setPages(data);
        } else if (activeTab === 'files') {
          const data = await api<PucFile[]>(`/puc/${selectedCourseId}/files`);
          if (!cancelled) setFiles(data);
        }
      } catch (err) {
        if (!cancelled) setTabError(extractApiError(err, 'Erro ao carregar dados do curso.'));
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    };

    void loadTab();
    return () => {
      cancelled = true;
    };
  }, [selectedCourseId, activeTab, isMobile, mobileShowCourses]);

  const handleSaveToken = async (event: FormEvent) => {
    event.preventDefault();
    if (savingToken || !tokenInput.trim()) return;
    setSavingToken(true);
    setTokenMessage(null);
    try {
      const res = await api<{ ok: boolean; token: TokenStatus }>('/puc/token', {
        method: 'POST',
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      setTokenInput('');
      setShowTokenForm(false);
      setTokenMessage({
        kind: 'ok',
        text: res.token.canvasUserName
          ? `Token validado para ${res.token.canvasUserName}.`
          : 'Token salvo e validado com sucesso.',
      });
      await loadBaseData();
    } catch (err) {
      setTokenMessage({
        kind: 'err',
        text: extractApiError(err, 'Não foi possível validar o token.'),
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleSync = async (mode: 'light' | 'full') => {
    if (syncing) return;
    setSyncing(true);
    setSyncFeedback('');
    try {
      const res = await api<{
        ok: boolean;
        coursesSynced?: number;
        durationMs?: number;
        warnings?: string[];
        error?: string;
      }>('/puc/sync', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const label = mode === 'full' ? 'Sincronização completa' : 'Sync leve';
        const dur = formatDurationMs(res.durationMs);
        const warnCount = res.warnings?.length || 0;
        setSyncFeedback(
          warnCount > 0
            ? `${label} concluído em ${dur} (${res.coursesSynced ?? 0} cursos, ${warnCount} aviso(s)).`
            : `${label} concluído em ${dur} (${res.coursesSynced ?? 0} cursos).`
        );
      } else {
        setSyncFeedback(res.error || 'Sincronização finalizada com erro.');
      }
      await loadBaseData();
    } catch (err) {
      setSyncFeedback(extractApiError(err, 'Falha ao sincronizar com o Canvas.'));
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleAiAllowed = async (course: PucCourse) => {
    if (togglingAiCourseId === course.id) return;
    setTogglingAiCourseId(course.id);
    try {
      const nextVal = course.aiAllowed === false;
      const updated = await api<{ id: number; aiAllowed: boolean }>(`/puc/courses/${course.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ aiAllowed: nextVal }),
      });
      setCourses((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, aiAllowed: updated.aiAllowed } : c))
      );
    } catch (err) {
      setInitError(extractApiError(err, 'Não foi possível atualizar a permissão de IA do curso.'));
    } finally {
      setTogglingAiCourseId(null);
    }
  };

  const handleToggleHidden = async (course: PucCourse) => {
    if (togglingCourseId === course.id) return;
    setTogglingCourseId(course.id);
    try {
      const updated = await api<{ id: number; hidden: boolean }>(`/puc/courses/${course.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ hidden: !course.hidden }),
      });
      setCourses((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, hidden: updated.hidden } : c))
      );
    } catch (err) {
      setInitError(extractApiError(err, 'Não foi possível atualizar a visibilidade do curso.'));
    } finally {
      setTogglingCourseId(null);
    }
  };

  const handleSaveAliases = async (courseId: number) => {
    if (savingAlias) return;
    setSavingAlias(true);
    try {
      const parsed = aliasInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await api<{ id: number; aliases: string[] }>(`/puc/courses/${courseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ aliases: parsed }),
      });
      setCourses((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, aliases: updated.aliases } : c))
      );
      setEditingAliasCourseId(null);
    } catch (err) {
      setInitError(extractApiError(err, 'Erro ao salvar apelidos do curso.'));
    } finally {
      setSavingAlias(false);
    }
  };

  const handleOpenAnnouncement = (ann: PucAnnouncement) => {
    setOpenAnnouncement(ann);
    if (!ann.read) {
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === ann.id && a.courseId === ann.courseId ? { ...a, read: true } : a))
      );
      setUpcoming((prev) => ({
        ...prev,
        announcements: prev.announcements.map((a) =>
          a.id === ann.id && a.courseId === ann.courseId ? { ...a, read: true } : a
        ),
      }));
      api(`/puc/${ann.courseId}/announcements/${ann.id}/read`, { method: 'POST' }).catch(() => undefined);
    }
  };

  const handleAskQuestion = async (questionText: string) => {
    const q = questionText.trim().slice(0, 400);
    if (!q || aiBusy) return;
    setAiBusy(true);
    setAiInput('');
    setAiOpen(true);

    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setChatHistory((prev) => [...prev, { id: entryId, question: q, loading: true }]);

    try {
      const res = await api<{ answer: string; items: AskItemRef[] }>('/puc/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      setChatHistory((prev) =>
        prev.map((item) =>
          item.id === entryId ? { ...item, loading: false, answer: res.answer, items: res.items } : item
        )
      );
    } catch (err) {
      setChatHistory((prev) =>
        prev.map((item) =>
          item.id === entryId
            ? { ...item, loading: false, error: extractApiError(err, 'Erro ao consultar a IA.') }
            : item
        )
      );
    } finally {
      setAiBusy(false);
    }
  };

  const triggerDownload = async (apiPath: string, key: string, openInNewTab = false) => {
    if (downloadingKey) return;
    setDownloadingKey(key);
    setDownloadError('');
    try {
      const { token } = await api<{ token: string }>('/puc/download-token', {
        method: 'POST',
        body: JSON.stringify({ path: apiPath }),
      });
      const url = `${apiPath}?dt=${encodeURIComponent(token)}`;
      if (openInNewTab) {
        window.open(url, '_blank', 'noopener');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      setDownloadError(extractApiError(err, 'Não foi possível iniciar o download.'));
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleOpenPage = async (courseId: number, slug: string) => {
    setLoadingPageSlug(slug);
    try {
      const detail = await api<PucPageDetail>(`/puc/${courseId}/pages/${encodeURIComponent(slug)}`);
      setOpenPage(detail);
    } catch (err) {
      setTabError(extractApiError(err, 'Não foi possível abrir a página.'));
    } finally {
      setLoadingPageSlug(null);
    }
  };

  const hiddenCount = useMemo(() => courses.filter((c) => c.hidden).length, [courses]);

  const groupedCourses = useMemo(() => {
    const filtered = showHidden ? courses : courses.filter((c) => !c.hidden);
    const map = new Map<string, PucCourse[]>();
    for (const c of filtered) {
      const key = c.termName || 'Sem semestre';
      const list = map.get(key) || [];
      list.push(c);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [courses, showHidden]);

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const assignmentCounts = useMemo(() => {
    let pending = 0;
    let overdue = 0;
    let submitted = 0;
    for (const a of assignments) {
      if (a.deliveryStatus === 'pendente') pending += 1;
      else if (a.deliveryStatus === 'atrasado') overdue += 1;
      else if (a.deliveryStatus === 'entregue' || a.deliveryStatus === 'corrigido') submitted += 1;
    }
    return { pending, overdue, submitted, all: assignments.length };
  }, [assignments]);

  const filteredAssignments = useMemo(() => {
    const base = assignments.filter((a) => {
      if (assignmentFilter === 'pending') return a.deliveryStatus === 'pendente';
      if (assignmentFilter === 'overdue') return a.deliveryStatus === 'atrasado';
      if (assignmentFilter === 'submitted') {
        return a.deliveryStatus === 'entregue' || a.deliveryStatus === 'corrigido';
      }
      return true;
    });
    return [...base].sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return a.name.localeCompare(b.name);
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [assignments, assignmentFilter]);

  const quickFilteredUpcoming = useMemo(() => {
    if (!quickFilter) return [];
    return upcoming.assignments.filter((a) => {
      if (quickFilter === 'today') return isDueTodaySaoPaulo(a.dueAt);
      if (quickFilter === 'week') return isDueWithinDaysSaoPaulo(a.dueAt, 7);
      if (quickFilter === 'overdue') return a.deliveryStatus === 'atrasado';
      if (quickFilter === 'pending') return a.deliveryStatus === 'pendente';
      return true;
    });
  }, [upcoming.assignments, quickFilter]);

  const courseGradesSummary = useMemo(() => {
    let earned = 0;
    let possible = 0;
    const rows = assignments.filter(
      (a) => a.pointsPossible !== null || a.score !== null || a.grade !== null
    );
    for (const a of rows) {
      if (typeof a.score === 'number' && typeof a.pointsPossible === 'number') {
        earned += a.score;
        possible += a.pointsPossible;
      }
    }
    return { rows, earned, possible };
  }, [assignments]);

  const groupedFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    const filtered = q
      ? files.filter(
          (f) =>
            f.displayName.toLowerCase().includes(q) ||
            f.originPath.toLowerCase().includes(q)
        )
      : files;
    const map = new Map<string, PucFile[]>();
    for (const f of filtered) {
      const folder = f.originPath || 'Raiz';
      const list = map.get(folder) || [];
      list.push(f);
      map.set(folder, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [files, fileSearch]);

  const token = status?.token;
  const progress = status?.progress;
  const summary = status?.summary;
  const tokenBannerTone = !token?.configured
    ? 'warn'
    : token.expired || token.expired401 || token.decryptError
      ? 'danger'
      : token.expiringSoon
        ? 'warn'
        : 'ok';

  return (
    <div className={`puc-page${isMobile ? ' is-mobile' : ''}`}>
      {/* ---- Topo: Status do Token, Sync Leve/Completo e Progresso ---- */}
      <header className="puc-header">
        <div className="puc-header-main">
          <div>
            <h1 className="puc-title">PUC · Canvas</h1>
            <p className="puc-subtitle">
              {status?.lastSync
                ? `Último sync (${status.lastSync.mode === 'full' ? 'completo' : 'leve'}): ${formatSaoPauloDateTime(
                    status.lastSync.finishedAt || status.lastSync.startedAt
                  )} · ${formatDurationMs(status.lastSync.durationMs)} (${status.lastSync.status})`
                : 'Nenhuma sincronização realizada ainda'}
            </p>
          </div>
          <div className="puc-header-actions">
            <button
              type="button"
              className={`btn ghost${aiOpen ? ' is-active-btn' : ''}`}
              onClick={() => setAiOpen((v) => !v)}
            >
              {aiOpen ? 'Fechar IA' : 'Perguntar à IA'}
            </button>
            <button
              type="button"
              className={`btn ghost${agentOpen ? ' is-active-btn' : ''}`}
              onClick={() => setAgentOpen((v) => !v)}
            >
              {agentOpen
                ? 'Fechar Agente'
                : agentBadge.activeJobs > 0
                  ? `Agente (${agentBadge.activeJobs} ativo)`
                  : agentBadge.enabled
                    ? agentBadge.paused
                      ? 'Agente (pausado)'
                      : 'Agente ●'
                    : 'Agente'}
            </button>
            <button
              type="button"
              className={`btn ghost${githubOpen ? ' is-active-btn' : ''}`}
              onClick={() => setGithubOpen((v) => !v)}
            >
              {githubOpen
                ? 'Fechar GitHub'
                : githubStatus?.expired || githubStatus?.authError || githubStatus?.expiringSoon
                  ? 'GitHub ⚠'
                  : 'GitHub'}
            </button>
            {token?.configured && !showTokenForm && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowTokenForm(true)}
              >
                Trocar token
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              disabled={syncing || !token?.configured}
              onClick={() => void handleSync('full')}
              title="Atualiza também páginas, módulos e arquivos"
            >
              Sincronização completa
            </button>
            <button
              type="button"
              className="btn"
              disabled={syncing || !token?.configured}
              onClick={() => void handleSync('light')}
            >
              {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
            </button>
          </div>
        </div>

        {/* Barra de progresso ao vivo do sync */}
        {syncing && (
          <div className="puc-sync-progress" role="status" aria-live="polite">
            <div className="puc-sync-progress-head">
              <span>
                {progress?.mode === 'full' ? 'Sync completo' : 'Sync leve'}:{' '}
                <strong>{progress?.stage || 'Iniciando...'}</strong>
                {progress?.currentCourse ? ` — ${progress.currentCourse}` : ''}
              </span>
              {progress && progress.totalCourses > 0 && (
                <span>
                  {progress.completedCourses}/{progress.totalCourses} cursos
                </span>
              )}
            </div>
            <div className="puc-progress-track">
              <div
                className="puc-progress-fill"
                style={{
                  width:
                    progress && progress.totalCourses > 0
                      ? `${Math.min(100, Math.round((progress.completedCourses / progress.totalCourses) * 100))}%`
                      : '20%',
                }}
              />
            </div>
          </div>
        )}

        {/* Contadores e filtros rápidos (Extra #2) */}
        {summary && token?.configured && (
          <div className="puc-quick-bar">
            <button
              type="button"
              className={`puc-quick-chip tone-warm${quickFilter === 'today' ? ' is-on' : ''}`}
              onClick={() => setQuickFilter((q) => (q === 'today' ? null : 'today'))}
            >
              Hoje <strong>{summary.dueToday}</strong>
            </button>
            <button
              type="button"
              className={`puc-quick-chip tone-accent${quickFilter === 'week' ? ' is-on' : ''}`}
              onClick={() => setQuickFilter((q) => (q === 'week' ? null : 'week'))}
            >
              Esta semana <strong>{summary.dueThisWeek}</strong>
            </button>
            <button
              type="button"
              className={`puc-quick-chip tone-danger${quickFilter === 'overdue' ? ' is-on' : ''}`}
              onClick={() => setQuickFilter((q) => (q === 'overdue' ? null : 'overdue'))}
            >
              Atrasados <strong>{summary.overdue}</strong>
            </button>
            <button
              type="button"
              className={`puc-quick-chip tone-muted${quickFilter === 'pending' ? ' is-on' : ''}`}
              onClick={() => setQuickFilter((q) => (q === 'pending' ? null : 'pending'))}
            >
              Pendentes <strong>{summary.pending}</strong>
            </button>
            <button
              type="button"
              className={`puc-quick-chip tone-warm${showAwaitingReview ? ' is-on' : ''}`}
              onClick={() => setShowAwaitingReview((v) => !v)}
            >
              A verificar: <strong>{summary.awaitingReview ?? awaitingReviewItems.length}</strong>
            </button>
            <button
              type="button"
              className={`puc-quick-chip tone-ok${showReadyToSubmit ? ' is-on' : ''}`}
              onClick={() => setShowReadyToSubmit((v) => !v)}
              title="Entregas já salvas no GitHub que ainda faltam enviar manualmente no Canvas"
            >
              Prontas para enviar: <strong>{summary.readyToSubmit ?? readyToSubmitItems.length}</strong>
            </button>
            <span className="puc-quick-stat">
              Entregues/Corrigidos: <strong>{summary.submitted + summary.graded}</strong>
            </span>
          </div>
        )}

        {/* Banner do Token */}
        {token && (
          <div className={`puc-token-banner tone-${tokenBannerTone}`} role="status">
            <div className="puc-token-banner-text">
              {!token.configured && (
                <strong>Token do Canvas não configurado. Cole um token pessoal abaixo para começar.</strong>
              )}
              {token.configured && (token.expired401 || token.expired || token.decryptError) && (
                <strong>
                  {token.decryptError
                    ? 'Não foi possível ler o token salvo (ENCRYPTION_KEY alterada). Cole um novo token.'
                    : 'Token expirado, cole um novo.'}
                </strong>
              )}
              {token.configured && !token.expired && !token.expired401 && !token.decryptError && (
                <span>
                  {token.expiringSoon ? 'Atenção: ' : ''}
                  <strong>
                    Token expira em {Math.max(0, token.daysRemaining ?? 0)} dia
                    {token.daysRemaining === 1 ? '' : 's'}
                  </strong>
                  {token.canvasUserName ? ` · ${token.canvasUserName}` : ''}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Alerta de expiração/erro do token GitHub */}
        {githubStatus?.configured &&
          (githubStatus.expired || githubStatus.authError || githubStatus.expiringSoon) && (
            <div
              className={`puc-token-banner tone-${
                githubStatus.expired || githubStatus.authError ? 'danger' : 'warn'
              }`}
              role="status"
            >
              <div className="puc-item-head">
                <strong>
                  {githubStatus.authError
                    ? `GitHub retornou HTTP ${githubStatus.authError}. Atualize o token fine-grained na aba GitHub.`
                    : githubStatus.expired
                      ? 'Token do GitHub expirado. Cole um novo token para continuar publicando entregas.'
                      : `Token do GitHub expira em ${Math.max(0, githubStatus.daysRemaining ?? 0)} dia(s).`}
                </strong>
                <button
                  type="button"
                  className="puc-hide-btn"
                  onClick={() => setGithubOpen(true)}
                >
                  Configurar GitHub
                </button>
              </div>
            </div>
          )}

        {/* Formulário de Token */}
        {showTokenForm && (
          <form className="puc-token-form" onSubmit={(e) => void handleSaveToken(e)}>
            <label htmlFor="puc-canvas-token">
              Token de acesso pessoal do Canvas (PUC Minas → Conta → Configurações → Novo token de acesso):
            </label>
            <div className="puc-token-form-row">
              <input
                id="puc-canvas-token"
                type="password"
                autoComplete="off"
                placeholder="Cole o token do Canvas aqui..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                disabled={savingToken}
              />
              <button type="submit" className="btn" disabled={savingToken || !tokenInput.trim()}>
                {savingToken ? 'Validando...' : 'Salvar'}
              </button>
              {token?.configured && !token.expired && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowTokenForm(false)}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}

        {tokenMessage && (
          <p className={`puc-feedback ${tokenMessage.kind === 'err' ? 'is-error' : 'is-ok'}`} role="alert">
            {tokenMessage.text}
          </p>
        )}
        {syncFeedback && <p className="puc-feedback">{syncFeedback}</p>}
        {downloadError && (
          <p className="puc-feedback is-error" role="alert">
            {downloadError}
          </p>
        )}
        {initError && (
          <div className="puc-feedback is-error" role="alert">
            {initError}{' '}
            <button type="button" className="btn ghost" onClick={() => void loadBaseData()}>
              Tentar novamente
            </button>
          </div>
        )}
      </header>

      {/* ---- Tela / Aba Agente de Automação PUC ---- */}
      {agentOpen && (
        <PucAgentPanel
          onOpenDeliverable={(cid, aid) => {
            setAssistantTarget({ courseId: cid, assignmentId: aid });
          }}
          onStatusChanged={(next) =>
            setAgentBadge((prev) =>
              prev.enabled === next.enabled &&
              prev.paused === next.paused &&
              prev.activeJobs === next.activeJobs
                ? prev
                : next
            )
          }
          onClose={() => setAgentOpen(false)}
        />
      )}

      {/* ---- Tela / Painel GitHub Privado ---- */}
      {githubOpen && (
        <PucGithubConfigPanel
          status={githubStatus}
          onSaved={(next) => setGithubStatus(next)}
          onClose={() => setGithubOpen(false)}
        />
      )}

      {/* ---- Caixa de Perguntas com IA (Req #4) ---- */}
      {aiOpen && (
        <section className="puc-ai-box" aria-label="Assistente IA da PUC">
          <div className="puc-ai-head">
            <strong>Perguntar sobre seus cursos (IA)</strong>
            {chatHistory.length > 0 && (
              <button type="button" className="puc-hide-btn" onClick={() => setChatHistory([])}>
                Limpar histórico
              </button>
            )}
          </div>
          <div className="puc-ai-suggestions">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="puc-suggestion-chip"
                disabled={aiBusy}
                onClick={() => void handleAskQuestion(q)}
              >
                {q}
              </button>
            ))}
          </div>
          {chatHistory.length > 0 && (
            <div className="puc-ai-history">
              {chatHistory.map((entry) => (
                <div key={entry.id} className="puc-ai-turn">
                  <div className="puc-ai-q">Você: {entry.question}</div>
                  {entry.loading ? (
                    <div className="puc-ai-a puc-muted">Consultando seus dados no Canvas...</div>
                  ) : entry.error ? (
                    <div className="puc-ai-a is-error">{entry.error}</div>
                  ) : (
                    <div className="puc-ai-a">
                      <div className="puc-ai-answer-text">{entry.answer}</div>
                      {entry.items && entry.items.length > 0 && (
                        <div className="puc-ai-refs">
                          {entry.items.map((ref, idx) =>
                            ref.htmlUrl ? (
                              <a
                                key={`${ref.title}-${idx}`}
                                href={ref.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="puc-ai-ref-link"
                              >
                                Abrir no Canvas: {ref.title}
                              </a>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <form
            className="puc-ai-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAskQuestion(aiInput);
            }}
          >
            <input
              type="text"
              maxLength={400}
              placeholder='Ex.: "O que falta entregar de IHC?" ou "Quando é a prova de AED?"'
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              disabled={aiBusy}
            />
            <button type="submit" className="btn" disabled={aiBusy || !aiInput.trim()}>
              {aiBusy ? 'Consultando...' : 'Perguntar'}
            </button>
          </form>
        </section>
      )}

      {/* ---- Painel de Entregas Prontas para Enviar no Canvas ---- */}
      {showReadyToSubmit && (
        <section className="puc-card">
          <div className="puc-item-head">
            <h2 className="puc-section-title">Prontas para enviar no Canvas ({readyToSubmitItems.length})</h2>
            <button type="button" className="puc-hide-btn" onClick={() => setShowReadyToSubmit(false)}>
              Fechar
            </button>
          </div>
          {readyToSubmitItems.length === 0 ? (
            <p className="puc-empty">Nenhuma entrega gerada aguardando envio manual no Canvas.</p>
          ) : (
            <ul className="puc-list">
              {readyToSubmitItems.map((item) => (
                <li
                  key={`${item.courseId}-${item.assignmentId}`}
                  className="puc-list-item is-clickable puc-ready-to-submit"
                  onClick={() => setAssistantTarget({ courseId: item.courseId, assignmentId: item.assignmentId })}
                >
                  <div className="puc-item-head">
                    <span className="puc-course-chip">{item.courseName}</span>
                    <div className="puc-assignment-actions">
                      <span className="puc-badge tone-ok">Entrega gerada</span>
                      <span className="puc-badge tone-warm">Pronto para enviar</span>
                    </div>
                  </div>
                  <strong className="puc-item-title">{item.assignmentName}</strong>
                  <div className="puc-item-meta">
                    <span>Prazo: {formatSaoPauloDateTime(item.dueAt)}</span>
                    {item.githubUrl && (
                      <a
                        href={item.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Ver no GitHub {item.version ? `(v${item.version})` : ''}
                      </a>
                    )}
                    {item.htmlUrl && (
                      <a
                        href={item.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Enviar no Canvas →
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- Painel de Entregas Aguardando Revisão ---- */}
      {showAwaitingReview && (
        <section className="puc-card">
          <div className="puc-item-head">
            <h2 className="puc-section-title">Entregas aguardando revisão</h2>
            <button type="button" className="puc-hide-btn" onClick={() => setShowAwaitingReview(false)}>
              Fechar
            </button>
          </div>
          {awaitingReviewItems.length === 0 ? (
            <p className="puc-empty">Nenhuma entrega aguardando revisão no momento.</p>
          ) : (
            <ul className="puc-list">
              {awaitingReviewItems.map((item) => (
                <li
                  key={`${item.courseId}-${item.assignmentId}`}
                  className="puc-list-item is-clickable"
                  onClick={() => setAssistantTarget({ courseId: item.courseId, assignmentId: item.assignmentId })}
                >
                  <div className="puc-item-head">
                    <span className="puc-course-chip">{item.courseName}</span>
                    <span className="puc-badge tone-warm">{item.statusLabel}</span>
                  </div>
                  <strong className="puc-item-title">{item.assignmentName}</strong>
                  <div className="puc-item-meta">
                    {item.pendingPlaceholdersCount > 0 && (
                      <span>{item.pendingPlaceholdersCount} [PREENCHER] pendente(s)</span>
                    )}
                    <span>Atualizada: {formatSaoPauloDateTime(item.updatedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- Painel de Filtro Rápido Selecionado (Extra #2) ---- */}
      {quickFilter && (
        <section className="puc-card">
          <div className="puc-item-head">
            <h2 className="puc-section-title">
              {quickFilter === 'today' && 'Entregas de hoje'}
              {quickFilter === 'week' && 'Entregas desta semana'}
              {quickFilter === 'overdue' && 'Trabalhos atrasados'}
              {quickFilter === 'pending' && 'Trabalhos pendentes'}
            </h2>
            <button type="button" className="puc-hide-btn" onClick={() => setQuickFilter(null)}>
              Fechar filtro
            </button>
          </div>
          {quickFilteredUpcoming.length === 0 ? (
            <p className="puc-empty">Nenhum trabalho encontrado para este filtro.</p>
          ) : (
            <ul className="puc-list">
              {quickFilteredUpcoming.map((a) => {
                const badge = statusBadgeInfo(a.deliveryStatus, a.score, a.pointsPossible, a.grade);
                return (
                  <li
                    key={`${a.courseId}-${a.id}`}
                    className="puc-list-item is-clickable"
                    onClick={() => setOpenAssignment(a)}
                  >
                    <div className="puc-item-head">
                      <span className="puc-course-chip">{a.courseName}</span>
                      <span className={`puc-badge tone-${badge.tone}`}>{badge.label}</span>
                    </div>
                    <strong className="puc-item-title">{a.name}</strong>
                    <div className="puc-item-meta">
                      <span>Prazo: {formatSaoPauloDateTime(a.dueAt)}</span>
                      {a.pointsPossible !== null && <span>{a.pointsPossible} pts</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {loadingInit ? (
        <div className="puc-state">Carregando dados da PUC...</div>
      ) : isMobile && !mobileShowCourses ? (
        /* ---- SHELL MOBILE: Resumo Compacto (somente pendentes/atrasados + avisos) ---- */
        <div className="puc-mobile-summary">
          <div className="puc-mobile-switch">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setMobileShowCourses(true)}
            >
              Ver cursos, notas e arquivos ({courses.filter((c) => !c.hidden).length})
            </button>
          </div>

          {/* Mobile compacto: projetos multi-parte (status das partes + abrir entrega) */}
          {allProjects.length > 0 && (
            <section className="puc-card">
              <h2 className="puc-section-title">Projetos multi-parte</h2>
              <ul className="puc-list">
                {allProjects.map((proj) => (
                  <li key={proj.projectId} className="puc-list-item">
                    <div className="puc-item-head">
                      <span className="puc-course-chip">{proj.courseName}</span>
                      <span className="puc-muted">{proj.parts.length} partes</span>
                    </div>
                    <strong className="puc-item-title">{proj.title}</strong>
                    <div className="puc-assignment-actions">
                      {proj.parts.map((part) => (
                        <button
                          key={part.assignmentId}
                          type="button"
                          className="puc-suggestion-chip"
                          onClick={() =>
                            setAssistantTarget({ courseId: proj.courseId, assignmentId: part.assignmentId })
                          }
                        >
                          P{part.order}: {part.timelineLabel}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="puc-card">
            <h2 className="puc-section-title">Pendentes e atrasados</h2>
            {upcoming.assignments.length === 0 ? (
              <p className="puc-empty">Nenhuma entrega pendente ou atrasada.</p>
            ) : (
              <ul className="puc-list">
                {upcoming.assignments.map((a) => {
                  const badge = statusBadgeInfo(a.deliveryStatus, a.score, a.pointsPossible, a.grade);
                  const delivBadge = a.deliverableStatus ? getDeliverableBadge(a.deliverableStatus) : null;
                  const courseObj = courses.find((c) => c.id === a.courseId);
                  const showAssistant = courseObj?.aiAllowed !== false || Boolean(a.deliverableStatus);
                  return (
                    <li
                      key={`${a.courseId}-${a.id}`}
                      className={`puc-list-item is-clickable${a.readyToSubmit ? ' puc-ready-to-submit' : ''}`}
                      onClick={() => setOpenAssignment(a)}
                    >
                      <div className="puc-item-head">
                        <span className="puc-course-chip">{a.courseName}</span>
                        <div className="puc-assignment-actions">
                          {delivBadge && (
                            <span className={`puc-badge tone-${delivBadge.tone}`}>{delivBadge.label}</span>
                          )}
                          {a.readyToSubmit && (
                            <span className="puc-badge tone-accent">Pronto para enviar</span>
                          )}
                          <span className={`puc-badge tone-${badge.tone}`}>{badge.label}</span>
                        </div>
                      </div>
                      <strong className="puc-item-title">{a.name}</strong>
                      <div className="puc-item-meta">
                        <span>Prazo: {formatSaoPauloDateTime(a.dueAt)}</span>
                        {showAssistant && (
                          <button
                            type="button"
                            className="puc-hide-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAssistantTarget({ courseId: a.courseId, assignmentId: a.id });
                            }}
                          >
                            Assistente
                          </button>
                        )}
                        {a.htmlUrl && (
                          <a
                            href={a.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Abrir no Canvas
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="puc-card">
            <h2 className="puc-section-title">Avisos recentes</h2>
            {upcoming.announcements.length === 0 ? (
              <p className="puc-empty">Nenhum aviso recente.</p>
            ) : (
              <ul className="puc-list">
                {upcoming.announcements.slice(0, 8).map((a) => (
                  <li
                    key={`${a.courseId}-${a.id}`}
                    className={`puc-list-item is-clickable${!a.read ? ' is-unread' : ''}`}
                    onClick={() => handleOpenAnnouncement(a)}
                  >
                    <div className="puc-item-head">
                      <span className="puc-course-chip">{a.courseName}</span>
                      <span className="puc-muted">
                        {!a.read ? '● Novo · ' : ''}
                        {formatSaoPauloDateTime(a.postedAt)}
                      </span>
                    </div>
                    <strong className="puc-item-title">{a.title}</strong>
                    {a.message && (
                      <p className="puc-announcement-preview">
                        {stripHtml(a.message).slice(0, 160)}
                        {stripHtml(a.message).length > 160 ? '…' : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        /* ---- SHELL WEB / TABLET (ou Mobile expandido): Versão Completa ---- */
        <div className="puc-layout">
          {isMobile && (
            <button
              type="button"
              className="btn ghost puc-mobile-back"
              onClick={() => setMobileShowCourses(false)}
            >
              ← Voltar ao resumo (prazos e avisos)
            </button>
          )}

          {/* Coluna Esquerda: Cursos agrupados por semestre */}
          <aside className="puc-courses-col">
            {hiddenCount > 0 && (
              <div className="puc-courses-toolbar">
                <label className="puc-hidden-toggle">
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(e) => setShowHidden(e.target.checked)}
                  />
                  <span>Mostrar ocultos ({hiddenCount})</span>
                </label>
              </div>
            )}

            {groupedCourses.length === 0 ? (
              <div className="puc-state">
                {courses.length === 0
                  ? 'Nenhum curso encontrado. Salve o token e clique em "Sincronizar agora".'
                  : 'Todos os cursos estão ocultos.'}
              </div>
            ) : (
              groupedCourses.map(([termName, termCourses]) => (
                <section key={termName} className="puc-term-group">
                  <h2 className="puc-term-title">{termName}</h2>
                  <ul className="puc-course-list">
                    {termCourses.map((course) => {
                      const active = course.id === selectedCourseId;
                      const allAliases = Array.from(
                        new Set([...(course.aliases || []), ...(course.autoAliases || [])])
                      );
                      const isEditingAlias = editingAliasCourseId === course.id;
                      return (
                        <li
                          key={course.id}
                          className={`puc-course-card${active ? ' is-selected' : ''}${course.hidden ? ' is-hidden' : ''}`}
                        >
                          <div className="puc-course-card-top">
                            <button
                              type="button"
                              className="puc-course-select"
                              onClick={() => {
                                setSelectedCourseId(course.id);
                                setOpenPage(null);
                              }}
                            >
                              <strong className="puc-course-name">{course.name}</strong>
                              <span className="puc-course-counts">
                                {course.filesCount} arq · {course.assignmentsCount} trab
                                {allAliases.length > 0 ? ` · ${allAliases.join(', ')}` : ''}
                              </span>
                            </button>
                            <div className="puc-course-actions">
                              <button
                                type="button"
                                className="puc-hide-btn"
                                title="Editar apelidos para a IA (ex.: IHC, PM)"
                                onClick={() => {
                                  if (isEditingAlias) {
                                    setEditingAliasCourseId(null);
                                  } else {
                                    setEditingAliasCourseId(course.id);
                                    setAliasInput((course.aliases || []).join(', '));
                                  }
                                }}
                              >
                                Sigla
                              </button>
                              <button
                                type="button"
                                className="puc-hide-btn"
                                title={course.hidden ? 'Mostrar curso no sync' : 'Ocultar curso'}
                                disabled={togglingCourseId === course.id}
                                onClick={() => void handleToggleHidden(course)}
                              >
                                {course.hidden ? 'Mostrar' : 'Ocultar'}
                              </button>
                            </div>
                          </div>
                          {isEditingAlias && (
                            <div className="puc-alias-editor">
                              <input
                                type="text"
                                placeholder="Ex.: IHC, Interação"
                                value={aliasInput}
                                onChange={(e) => setAliasInput(e.target.value)}
                              />
                              <button
                                type="button"
                                className="btn"
                                disabled={savingAlias}
                                onClick={() => void handleSaveAliases(course.id)}
                              >
                                OK
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </aside>

          {/* Coluna Direita: Detalhes do Curso */}
          <section className="puc-detail-col">
            {!selectedCourse ? (
              <div className="puc-state">
                Selecione um curso ao lado para ver trabalhos, avisos, notas, páginas e arquivos.
              </div>
            ) : (
              <>
                <div className="puc-detail-header">
                  <div>
                    <span className="puc-course-chip">{selectedCourse.termName}</span>
                    <h2 className="puc-detail-title">{selectedCourse.name}</h2>
                  </div>
                  <div className="puc-detail-header-actions">
                    <label className="puc-hidden-toggle" title="Quando desligado, o botão de geração com IA some neste curso">
                      <input
                        type="checkbox"
                        checked={selectedCourse.aiAllowed !== false}
                        disabled={togglingAiCourseId === selectedCourse.id}
                        onChange={() => void handleToggleAiAllowed(selectedCourse)}
                      />
                      <span>IA permitida</span>
                    </label>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={downloadingKey !== null}
                      onClick={() =>
                        void triggerDownload(
                          `/api/puc/${selectedCourse.id}/download.zip`,
                          `course-${selectedCourse.id}`
                        )
                      }
                    >
                      {downloadingKey === `course-${selectedCourse.id}`
                        ? 'Preparando ZIP...'
                        : 'Baixar curso (ZIP)'}
                    </button>
                  </div>
                </div>

                <div className="seg puc-tabs" role="tablist" aria-label="Seções do curso">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'assignments'}
                    className={activeTab === 'assignments' ? 'on' : ''}
                    onClick={() => setActiveTab('assignments')}
                  >
                    Trabalhos ({selectedCourse.assignmentsCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'announcements'}
                    className={activeTab === 'announcements' ? 'on' : ''}
                    onClick={() => setActiveTab('announcements')}
                  >
                    Avisos ({selectedCourse.announcementsCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'grades'}
                    className={activeTab === 'grades' ? 'on' : ''}
                    onClick={() => setActiveTab('grades')}
                  >
                    Notas
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'pages'}
                    className={activeTab === 'pages' ? 'on' : ''}
                    onClick={() => setActiveTab('pages')}
                  >
                    Páginas ({selectedCourse.pagesCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'files'}
                    className={activeTab === 'files' ? 'on' : ''}
                    onClick={() => setActiveTab('files')}
                  >
                    Arquivos ({selectedCourse.filesCount})
                  </button>
                </div>

                <div className="puc-tab-panel">
                  {tabLoading ? (
                    <div className="puc-state">Carregando...</div>
                  ) : tabError ? (
                    <div className="puc-feedback is-error" role="alert">
                      {tabError}
                    </div>
                  ) : activeTab === 'assignments' ? (
                    <>
                      <div className="puc-filter-row">
                        <button
                          type="button"
                          className={`puc-filter-pill${assignmentFilter === 'pending' ? ' is-on' : ''}`}
                          onClick={() => setAssignmentFilter('pending')}
                        >
                          Pendentes ({assignmentCounts.pending})
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${assignmentFilter === 'overdue' ? ' is-on' : ''}`}
                          onClick={() => setAssignmentFilter('overdue')}
                        >
                          Atrasados ({assignmentCounts.overdue})
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${assignmentFilter === 'submitted' ? ' is-on' : ''}`}
                          onClick={() => setAssignmentFilter('submitted')}
                        >
                          Entregues ({assignmentCounts.submitted})
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${assignmentFilter === 'all' ? ' is-on' : ''}`}
                          onClick={() => setAssignmentFilter('all')}
                        >
                          Todos ({assignmentCounts.all})
                        </button>
                      </div>

                      {/* Projetos multi-parte detectados no curso */}
                      {courseProjects.length > 0 && (
                        <div className="puc-projects-strip">
                          {courseProjects.map((proj) => (
                            <section key={proj.projectId} className="puc-timeline-card">
                              <div className="puc-item-head">
                                <strong>Projeto multi-parte: {proj.title}</strong>
                                <span className="puc-muted">{proj.parts.length} parte(s)</span>
                              </div>
                              <div className="puc-timeline-steps">
                                {proj.parts.map((part) => (
                                  <button
                                    key={part.assignmentId}
                                    type="button"
                                    className="puc-timeline-step"
                                    onClick={() =>
                                      setAssistantTarget({
                                        courseId: proj.courseId,
                                        assignmentId: part.assignmentId,
                                      })
                                    }
                                  >
                                    <div className="puc-item-head">
                                      <span className="puc-muted">Parte {part.order}</span>
                                      <span className="puc-badge tone-accent">{part.timelineLabel}</span>
                                    </div>
                                    <strong className="puc-timeline-step-title">{part.name}</strong>
                                    <span className="puc-muted">
                                      Prazo: {formatSaoPauloDateTime(part.dueAt)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      )}

                      {filteredAssignments.length === 0 ? (
                        <div className="puc-state">Nenhum trabalho neste filtro.</div>
                      ) : (
                        <ul className="puc-list">
                          {filteredAssignments.map((a) => {
                            const badge = statusBadgeInfo(
                              a.deliveryStatus,
                              a.score,
                              a.pointsPossible,
                              a.grade
                            );
                            const delivBadge = a.deliverableStatus
                              ? getDeliverableBadge(a.deliverableStatus)
                              : null;
                            const showAssistantBtn =
                              selectedCourse.aiAllowed !== false || Boolean(a.deliverableStatus);
                            return (
                              <li
                                key={a.id}
                                className={`puc-list-item is-clickable${a.readyToSubmit ? ' puc-ready-to-submit' : ''}`}
                                onClick={() => setOpenAssignment(a)}
                              >
                                <div className="puc-item-head">
                                  <strong className="puc-item-title">{a.name}</strong>
                                  <div className="puc-assignment-actions">
                                    {a.assignmentKind === 'multi_part' && (
                                      <span className="puc-badge tone-accent">
                                        Multi-parte{a.partOrder ? ` · P${a.partOrder}` : ''}
                                      </span>
                                    )}
                                    {a.statementChanged && (
                                      <span className="puc-badge tone-danger">Enunciado mudou</span>
                                    )}
                                    {a.readyToSubmit && (
                                      <span className="puc-badge tone-accent">Pronto para enviar</span>
                                    )}
                                    {delivBadge && (
                                      <span className={`puc-badge tone-${delivBadge.tone}`}>
                                        {delivBadge.label}
                                      </span>
                                    )}
                                    <span className={`puc-badge tone-${badge.tone}`}>{badge.label}</span>
                                  </div>
                                </div>
                                <div className="puc-item-meta">
                                  <span>Prazo: {formatSaoPauloDateTime(a.dueAt)}</span>
                                  {a.submittedAt && (
                                    <span>Entregue: {formatSaoPauloDateTime(a.submittedAt)}</span>
                                  )}
                                  {a.pointsPossible !== null && <span>{a.pointsPossible} pts</span>}
                                  {showAssistantBtn && (
                                    <button
                                      type="button"
                                      className={
                                        a.deliverableStatus === 'enviado_a_verificar' ? 'btn' : 'btn ghost'
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAssistantTarget({
                                          courseId: a.courseId,
                                          assignmentId: a.id,
                                        });
                                      }}
                                    >
                                      {a.deliverableStatus === 'enviado_a_verificar'
                                        ? 'Abrir para verificar'
                                        : 'Assistente'}
                                    </button>
                                  )}
                                  {a.githubUrl && (
                                    <a
                                      href={a.githubUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Ver no GitHub
                                    </a>
                                  )}
                                  {a.htmlUrl && (
                                    <a
                                      href={a.htmlUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Abrir no Canvas
                                    </a>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : activeTab === 'announcements' ? (
                    announcements.length === 0 ? (
                      <div className="puc-state">Nenhum aviso publicado neste curso.</div>
                    ) : (
                      <ul className="puc-list">
                        {announcements.map((a) => (
                          <li
                            key={a.id}
                            className={`puc-list-item is-clickable${!a.read ? ' is-unread' : ''}`}
                            onClick={() => handleOpenAnnouncement(a)}
                          >
                            <div className="puc-item-head">
                              <strong className="puc-item-title">
                                {!a.read && <span className="puc-unread-dot" aria-label="Não lido" />}
                                {a.title}
                              </strong>
                              <span className="puc-muted">{formatSaoPauloDateTime(a.postedAt)}</span>
                            </div>
                            {a.authorName && <span className="puc-muted">Por {a.authorName}</span>}
                            {a.message && (
                              <p className="puc-announcement-preview">
                                {stripHtml(a.message).slice(0, 220)}
                                {stripHtml(a.message).length > 220 ? '…' : ''}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : activeTab === 'grades' ? (
                    /* Extra #3: Aba Notas */
                    courseGradesSummary.rows.length === 0 ? (
                      <div className="puc-state">Nenhuma atividade avaliativa registrada neste curso.</div>
                    ) : (
                      <div className="puc-grades-wrap">
                        <div className="puc-grades-total">
                          Total corrigido:{' '}
                          <strong>
                            {courseGradesSummary.earned.toFixed(1)} / {courseGradesSummary.possible.toFixed(1)} pts
                          </strong>
                          {courseGradesSummary.possible > 0 && (
                            <span className="puc-muted">
                              {' '}
                              ({Math.round((courseGradesSummary.earned / courseGradesSummary.possible) * 100)}%)
                            </span>
                          )}
                        </div>
                        <table className="puc-grades-table">
                          <thead>
                            <tr>
                              <th>Atividade</th>
                              <th>Status</th>
                              <th>Nota</th>
                            </tr>
                          </thead>
                          <tbody>
                            {courseGradesSummary.rows.map((a) => {
                              const badge = statusBadgeInfo(
                                a.deliveryStatus,
                                a.score,
                                a.pointsPossible,
                                a.grade
                              );
                              return (
                                <tr key={a.id} onClick={() => setOpenAssignment(a)}>
                                  <td>{a.name}</td>
                                  <td>
                                    <span className={`puc-badge tone-${badge.tone}`}>{badge.label}</span>
                                  </td>
                                  <td>
                                    {a.score !== null ? a.score : a.grade || '—'}
                                    {a.pointsPossible !== null ? ` / ${a.pointsPossible}` : ''}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : activeTab === 'pages' ? (
                    pages.length === 0 ? (
                      <div className="puc-state">
                        Nenhuma página sincronizada. Use "Sincronização completa" para baixar páginas.
                      </div>
                    ) : (
                      <ul className="puc-list">
                        {pages.map((p) => (
                          <li key={p.slug} className="puc-list-item puc-page-row">
                            <div>
                              <strong className="puc-item-title">{p.title}</strong>
                              <div className="puc-item-meta">
                                <span>Atualizada: {formatSaoPauloDateTime(p.updatedAt)}</span>
                                {p.htmlUrl && (
                                  <a href={p.htmlUrl} target="_blank" rel="noopener noreferrer">
                                    Abrir no Canvas
                                  </a>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={loadingPageSlug === p.slug}
                              onClick={() => void handleOpenPage(selectedCourse.id, p.slug)}
                            >
                              {loadingPageSlug === p.slug ? 'Abrindo...' : 'Ler offline'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : (
                    /* Aba Arquivos */
                    <div className="puc-files-wrap">
                      <input
                        type="search"
                        className="puc-file-search"
                        placeholder="Buscar arquivo ou pasta..."
                        value={fileSearch}
                        onChange={(e) => setFileSearch(e.target.value)}
                      />
                      {groupedFiles.length === 0 ? (
                        <div className="puc-state">
                          {files.length === 0
                            ? 'Nenhum arquivo sincronizado. Use "Sincronização completa" para listar arquivos.'
                            : 'Nenhum arquivo corresponde à busca.'}
                        </div>
                      ) : (
                        groupedFiles.map(([folder, folderFiles]) => (
                          <details key={folder} className="puc-folder-group" open>
                            <summary className="puc-folder-summary">
                              <span>{folder}</span>
                              <span className="puc-muted">{folderFiles.length}</span>
                            </summary>
                            <ul className="puc-file-list">
                              {folderFiles.map((f) => (
                                <li key={f.id} className="puc-file-row">
                                  <div className="puc-file-info">
                                    <span className="puc-file-name">{f.displayName}</span>
                                    <span className="puc-muted">
                                      {formatFileSize(f.size)} · {formatSaoPauloDateTime(f.updatedAt)}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn ghost"
                                    disabled={downloadingKey !== null}
                                    onClick={() =>
                                      void triggerDownload(
                                        `/api/puc/files/${f.id}/download`,
                                        `file-${f.id}`,
                                        true
                                      )
                                    }
                                  >
                                    {downloadingKey === `file-${f.id}` ? 'Abrindo...' : 'Baixar'}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* ---- Modal / Bottom Sheet: Detalhe da Tarefa (Req #3) ---- */}
      {openAssignment && (() => {
        const badge = statusBadgeInfo(
          openAssignment.deliveryStatus,
          openAssignment.score,
          openAssignment.pointsPossible,
          openAssignment.grade
        );
        const safeDescription = sanitizeCanvasHtml(openAssignment.description);
        return (
          <div
            className={`puc-modal-backdrop${isMobile ? ' is-sheet' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={openAssignment.name}
            onClick={() => setOpenAssignment(null)}
          >
            <div className="puc-modal puc-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="puc-modal-header">
                <div>
                  {openAssignment.courseName && (
                    <span className="puc-course-chip">{openAssignment.courseName}</span>
                  )}
                  <h3>{openAssignment.name}</h3>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className={`btn ghost${submitPanelOpen ? ' is-active-btn' : ''}`}
                    onClick={() => {
                      setSubmitPanelOpen((v) => !v);
                      setSubmitError('');
                      setSubmitSuccess('');
                    }}
                  >
                    {submitPanelOpen ? 'Cancelar envio' : 'Enviar anexo'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      const target = { courseId: openAssignment.courseId, assignmentId: openAssignment.id };
                      setOpenAssignment(null);
                      setSubmitPanelOpen(false);
                      setAssistantTarget(target);
                    }}
                  >
                    Assistente
                  </button>
                  {openAssignment.htmlUrl && (
                    <a
                      href={openAssignment.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn ghost"
                    >
                      Abrir no Canvas
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setOpenAssignment(null);
                      setSubmitPanelOpen(false);
                    }}
                  >
                    Fechar
                  </button>
                </div>
              </div>
              <div className="puc-modal-body">
                {submitPanelOpen && (
                  <form
                    className="puc-ai-box"
                    style={{ marginBottom: 14 }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (submitFiles.length === 0) {
                        setSubmitError('Selecione pelo menos um arquivo para enviar.');
                        return;
                      }
                      const fileListLabel = submitFiles.map((f) => f.name).join(', ');
                      if (
                        !window.confirm(
                          `Confirmar envio para o Canvas?\n\nTrabalho: ${openAssignment.name}\nArquivos: ${fileListLabel}`
                        )
                      ) {
                        return;
                      }
                      setSubmittingCanvas(true);
                      setSubmitError('');
                      setSubmitSuccess('');
                      try {
                        const encodedFiles = await Promise.all(
                          submitFiles.map(
                            (file) =>
                              new Promise<{ name: string; mimeType: string; contentBase64: string }>(
                                (resolve, reject) => {
                                  const reader = new FileReader();
                                  reader.onload = () => {
                                    const res = String(reader.result || '');
                                    const b64 = res.includes(',') ? res.split(',')[1] : res;
                                    resolve({
                                      name: file.name,
                                      mimeType: file.type || 'application/octet-stream',
                                      contentBase64: b64,
                                    });
                                  };
                                  reader.onerror = () => reject(new Error(`Falha ao ler ${file.name}`));
                                  reader.readAsDataURL(file);
                                }
                              )
                          )
                        );
                        const resp = await api<{
                          ok: boolean;
                          submittedAt: string;
                          workflowState: string;
                          attachments?: AssignmentAttachment[];
                        }>(`/puc/${openAssignment.courseId}/assignments/${openAssignment.id}/submit`, {
                          method: 'POST',
                          body: JSON.stringify({
                            confirmSubmit: true,
                            comment: submitComment.trim() || undefined,
                            files: encodedFiles,
                          }),
                        });
                        setSubmitSuccess('Anexo enviado para o Canvas com sucesso!');
                        setSubmitFiles([]);
                        setSubmitComment('');
                        setOpenAssignment((prev) =>
                          prev
                            ? {
                                ...prev,
                                workflowState: resp.workflowState || 'submitted',
                                submittedAt: resp.submittedAt || new Date().toISOString(),
                                deliveryStatus: 'entregue',
                                attachments: resp.attachments?.length ? resp.attachments : prev.attachments,
                              }
                            : prev
                        );
                        void loadBaseData();
                      } catch (err) {
                        setSubmitError(
                          err instanceof Error ? err.message : 'Erro ao enviar anexo para o Canvas.'
                        );
                      } finally {
                        setSubmittingCanvas(false);
                      }
                    }}
                  >
                    <div className="puc-ai-head">
                      <strong>Enviar anexo para o Canvas (somente você)</strong>
                    </div>
                    <p className="puc-muted" style={{ margin: '4px 0 10px' }}>
                      Envio manual direto para a PUC Minas. Máximo 5 arquivos (25 MB no total).
                    </p>
                    <input
                      type="file"
                      multiple
                      disabled={submittingCanvas}
                      onChange={(e) => {
                        const list = e.target.files ? Array.from(e.target.files) : [];
                        setSubmitFiles(list);
                        setSubmitError('');
                      }}
                    />
                    {submitFiles.length > 0 && (
                      <ul className="puc-detail-sublist" style={{ marginTop: 8 }}>
                        {submitFiles.map((f, idx) => (
                          <li key={`${f.name}-${idx}`}>
                            {f.name} ({formatFileSize(f.size)})
                          </li>
                        ))}
                      </ul>
                    )}
                    <input
                      type="text"
                      placeholder="Comentário opcional para o professor..."
                      value={submitComment}
                      disabled={submittingCanvas}
                      onChange={(e) => setSubmitComment(e.target.value)}
                      style={{ marginTop: 8, width: '100%' }}
                    />
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        type="submit"
                        className="btn"
                        disabled={submittingCanvas || submitFiles.length === 0}
                      >
                        {submittingCanvas ? 'Enviando para o Canvas...' : 'Confirmar e enviar para o Canvas'}
                      </button>
                    </div>
                    {submitError && (
                      <p className="puc-feedback is-error" role="alert">
                        {submitError}
                      </p>
                    )}
                    {submitSuccess && <p className="puc-feedback is-ok">{submitSuccess}</p>}
                  </form>
                )}
                <div className="puc-detail-meta-grid">
                  <div>
                    <span className="puc-muted">Status</span>
                    <div>
                      <span className={`puc-badge tone-${badge.tone}`}>{badge.label}</span>
                    </div>
                  </div>
                  <div>
                    <span className="puc-muted">Prazo (Brasília)</span>
                    <strong>{formatSaoPauloDateTime(openAssignment.dueAt)}</strong>
                  </div>
                  <div>
                    <span className="puc-muted">Entregue em</span>
                    <strong>{formatSaoPauloDateTime(openAssignment.submittedAt)}</strong>
                  </div>
                  <div>
                    <span className="puc-muted">Nota / Pontos</span>
                    <strong>
                      {openAssignment.score !== null ? openAssignment.score : openAssignment.grade || '—'}
                      {openAssignment.pointsPossible !== null ? ` / ${openAssignment.pointsPossible}` : ''}
                    </strong>
                  </div>
                  {openAssignment.submissionTypes.length > 0 && (
                    <div>
                      <span className="puc-muted">Tipo de entrega</span>
                      <strong>{openAssignment.submissionTypes.join(', ')}</strong>
                    </div>
                  )}
                </div>

                {openAssignment.attachments && openAssignment.attachments.length > 0 && (
                  <div className="puc-detail-section">
                    <h4>Anexos enviados</h4>
                    <ul className="puc-detail-sublist">
                      {openAssignment.attachments.map((att, idx) => (
                        <li key={`${att.display_name}-${idx}`}>
                          {att.display_name} ({formatFileSize(att.size)})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {openAssignment.rubric && openAssignment.rubric.length > 0 && (
                  <div className="puc-detail-section">
                    <h4>Rubrica</h4>
                    <ul className="puc-detail-sublist">
                      {openAssignment.rubric.map((crit, idx) => (
                        <li key={crit.id || idx}>
                          <strong>{crit.description}</strong> ({crit.points} pts)
                          {crit.long_description ? ` — ${crit.long_description}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="puc-detail-section">
                  <h4>Descrição</h4>
                  {safeDescription ? (
                    <div
                      className="puc-rich-html"
                      dangerouslySetInnerHTML={{ __html: safeDescription }}
                    />
                  ) : (
                    <p className="puc-muted">Sem descrição cadastrada no Canvas.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- Modal / Bottom Sheet: Detalhe do Aviso (Req #3) ---- */}
      {openAnnouncement && (
        <div
          className={`puc-modal-backdrop${isMobile ? ' is-sheet' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={openAnnouncement.title}
          onClick={() => setOpenAnnouncement(null)}
        >
          <div className="puc-modal puc-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="puc-modal-header">
              <div>
                {openAnnouncement.courseName && (
                  <span className="puc-course-chip">{openAnnouncement.courseName}</span>
                )}
                <h3>{openAnnouncement.title}</h3>
                <span className="puc-muted">
                  {openAnnouncement.authorName ? `Por ${openAnnouncement.authorName} · ` : ''}
                  {formatSaoPauloDateTime(openAnnouncement.postedAt)}
                </span>
              </div>
              <div className="row">
                {openAnnouncement.htmlUrl && (
                  <a
                    href={openAnnouncement.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn ghost"
                  >
                    Abrir no Canvas
                  </a>
                )}
                <button type="button" className="btn" onClick={() => setOpenAnnouncement(null)}>
                  Fechar
                </button>
              </div>
            </div>
            <div className="puc-modal-body">
              <div
                className="puc-rich-html"
                dangerouslySetInnerHTML={{ __html: sanitizeCanvasHtml(openAnnouncement.message) }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ---- Modal de leitura offline de Página HTML ---- */}
      {openPage && (
        <div
          className="puc-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={openPage.title}
          onClick={() => setOpenPage(null)}
        >
          <div className="puc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="puc-modal-header">
              <h3>{openPage.title}</h3>
              <div className="row">
                {openPage.htmlUrl && (
                  <a
                    href={openPage.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn ghost"
                  >
                    Abrir no Canvas
                  </a>
                )}
                <button type="button" className="btn" onClick={() => setOpenPage(null)}>
                  Fechar
                </button>
              </div>
            </div>
            <iframe
              className="puc-page-iframe"
              title={openPage.title}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={buildOfflineSrcDoc(openPage.title, openPage.body)}
            />
          </div>
        </div>
      )}
      {/* ---- Modal do Assistente de Trabalhos PUC ---- */}
      {assistantTarget && (
        <PucWorkAssistantModal
          courseId={assistantTarget.courseId}
          assignmentId={assistantTarget.assignmentId}
          isMobile={isMobile}
          onClose={() => setAssistantTarget(null)}
          onSwitchAssignment={(cid, aid) => setAssistantTarget({ courseId: cid, assignmentId: aid })}
          onTriggerDownload={triggerDownload}
          onUpdated={() => {
            void loadBaseData();
            if (selectedCourseId && (activeTab === 'assignments' || activeTab === 'grades')) {
              api<PucAssignment[]>(`/puc/${selectedCourseId}/assignments`)
                .then(setAssignments)
                .catch(() => undefined);
              api<MultiPartProjectSummary[]>(`/puc/assistant/projects?courseId=${selectedCourseId}`)
                .then(setCourseProjects)
                .catch(() => undefined);
            }
          }}
        />
      )}
    </div>
  );
}
