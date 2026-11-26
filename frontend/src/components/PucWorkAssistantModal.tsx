import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatSaoPauloDateTime, sanitizeCanvasHtml } from '../lib/canvasHtml';

export type DeliverableStatus =
  | 'rascunho'
  | 'enviado_a_verificar'
  | 'revisada_por_mim'
  | 'validada'
  | 'entrega_gerada';

interface ProviderOption {
  id: 'gemini' | 'groq' | 'openrouter';
  label: string;
  model: string;
}

interface UnderstandingAttachmentItem {
  fileId?: number;
  name: string;
  contentType: string;
  pages: number;
  charsExtracted: number;
  status: 'ok' | 'empty' | 'error' | 'too_large';
  needsVision: boolean;
  visionReason?: string | null;
  error?: string;
}

interface DetectedQuestionsSummary {
  total: number;
  closed: number;
  open: number;
  other: number;
  questionNumbers: number[];
  hasCrosswordOrGrid: boolean;
  hasFiguresOrTables: boolean;
}

interface CompletenessCheckResult {
  expectedCount: number;
  answeredCount: number;
  expectedNumbers: number[];
  answeredNumbers: number[];
  missingNumbers: number[];
  passed: boolean;
}

interface GenerationSourceRef {
  kind: string;
  label: string;
  detail?: string;
}

interface UnderstandingSummary {
  assignmentId: number;
  assignmentName: string;
  courseId: number;
  courseName: string;
  submissionTypes: string[];
  detectedFormat: 'manuscrito' | 'digitado' | 'codigo' | 'link' | 'arquivo';
  isHandwritten: boolean;
  handwrittenKeywords: string[];
  isGroup: boolean;
  dueAt: string | null;
  pointsPossible: number | null;
  hasRubric: boolean;
  attachments: UnderstandingAttachmentItem[];
  questions: DetectedQuestionsSummary;
  titleDivergence: {
    hasDivergence: boolean;
    reason: string | null;
    detectedAttachmentTitle: string | null;
  };
  unreadableAttachments: boolean;
  needsVision: boolean;
  canProceed: boolean;
  blockReason: string | null;
  sourcesPreview: GenerationSourceRef[];
}

interface ProjectPartItem {
  assignmentId: number;
  name: string;
  order: number;
  dependsOn: number | null;
  dueAt: string | null;
  suggestedStartAt: string | null;
  suggestedReviewAt: string | null;
  timelineState: string;
  timelineLabel: string;
  deliverableStatus: DeliverableStatus | null;
  score: number | null;
  pointsPossible: number | null;
  grade: string | null;
  htmlUrl: string | null;
}

interface DeliverableVersion {
  version: number;
  createdAt: string;
  provider: string;
  providerLabel: string;
  model: string;
  source: string;
  markdown: string;
}

interface ReviewIssue {
  category: string;
  severity: 'alta' | 'media' | 'baixa';
  location: string;
  problem: string;
  suggestion: string;
}

interface ReviewRecord {
  summary: string;
  issues: ReviewIssue[];
  provider: string;
  providerLabel: string;
  model: string;
  pendingPlaceholders: string[];
  reviewedAt: string;
}

interface GithubPublicationRecord {
  version: number;
  commitSha: string;
  htmlUrl: string;
  folderUrl: string;
  pdfPath: string | null;
  txtPath?: string | null;
  mdPath: string;
  zipPath: string | null;
  codePaths: string[];
  publishedAt: string;
  contentHash: string;
}

interface GithubStatusSummary {
  configured: boolean;
  owner: string;
  repo: string;
  branch: string;
  autoPublish: boolean;
  daysRemaining: number | null;
  expiringSoon: boolean;
  expired: boolean;
  authError: 401 | 403 | null;
}

interface AssistantWorkspaceResponse {
  course: {
    id: number;
    name: string;
    aiAllowed: boolean;
    myProject?: string;
    groupMembers: string[];
  };
  studentName: string;
  assignment: {
    id: number;
    courseId: number;
    name: string;
    description: string | null;
    dueAt: string | null;
    pointsPossible: number | null;
    submissionTypes: string[];
    htmlUrl: string | null;
    score: number | null;
    grade: string | null;
    deliveryStatus?: string;
    rubric: Array<{ id: string | null; description: string; long_description: string; points: number }>;
    submissionComments: Array<{ author_name?: string | null; comment?: string | null; created_at?: string | null }>;
    assignmentKind: 'multi_part' | 'one_shot';
    assignmentKindManual: boolean;
    projectId: string | null;
  };
  project: {
    projectId: string;
    title: string;
    manual: boolean;
    parts: ProjectPartItem[];
  } | null;
  canGenerate: boolean;
  generateBlockedReason: string | null;
  lessons: {
    charged_points?: string[];
    recurring_issues?: string[];
    strengths?: string[];
  } | null;
  deliverable: {
    status: DeliverableStatus;
    statusLabel: string;
    readyToSubmit?: boolean;
    isHandwritten?: boolean;
    isGroup?: boolean;
    currentMarkdown: string;
    completeness?: CompletenessCheckResult | null;
    completenessOverridden?: boolean;
    usedSources?: GenerationSourceRef[];
    validationWarnings?: string[];
    groupMembers: string[];
    versions: DeliverableVersion[];
    publications?: GithubPublicationRecord[];
    lastPublishedUrl?: string | null;
    lastPublishedFolderUrl?: string | null;
    lastPublishedVersion?: number | null;
    lastPublishedAt?: string | null;
    hasPendingGithub?: boolean;
    pendingHtmlUrl?: string | null;
    pendingFolderUrl?: string | null;
    statementChanged?: boolean;
    generatedByAgent?: boolean;
    estimatedCostUsd?: number | null;
    hasUnpublishedChanges?: boolean;
    lastReview: ReviewRecord | null;
    hasCodeFiles: boolean;
    codeFilesCount: number;
    exportGate: {
      allowed: boolean;
      reasons: string[];
      pendingPlaceholders: string[];
    };
    publishGate?: {
      allowed: boolean;
      reasons: string[];
      pendingPlaceholders: string[];
    };
    updatedAt: string | null;
  } | null;
  github?: GithubStatusSummary;
  providers: ProviderOption[];
}

interface PucWorkAssistantModalProps {
  courseId: number;
  assignmentId: number;
  isMobile: boolean;
  onClose: () => void;
  onSwitchAssignment: (courseId: number, assignmentId: number) => void;
  onTriggerDownload: (apiPath: string, key: string, openInNewTab?: boolean) => Promise<void>;
  onUpdated?: () => void;
}

function findLocalPlaceholders(markdown: string): string[] {
  return (String(markdown || '').match(/\[PREENCHER(?:\s*:[^\]]*)?\]/gi) || []).map((m) => m.trim());
}

function checkLocalCompleteness(
  expectedNumbers: number[],
  markdown: string
): CompletenessCheckResult | null {
  if (!expectedNumbers || expectedNumbers.length === 0) return null;
  const text = String(markdown || '');
  const answeredNumbers: number[] = [];
  const missingNumbers: number[] = [];

  for (const num of expectedNumbers) {
    const padded = num < 10 ? `0?${num}` : `${num}`;
    const pattern = new RegExp(
      `(?:^|\\n)\\s*(?:(?:#{1,6}\\s*)?(?:\\*\\*)?(?:quest[aã]o|pergunta|exerc[ií]cio|q)\\s*${padded}(?:\\*\\*)?(?:\\s*[-–—.)\\]:(]|\\s*(?=\\n|$))|(?:#{1,6}\\s*)?(?:\\*\\*)?${padded}(?:\\*\\*)?\\s*(?:[-–—.)\\]:(]|\\s+-\\s+))`,
      'i'
    );
    if (pattern.test(text)) {
      answeredNumbers.push(num);
    } else {
      missingNumbers.push(num);
    }
  }

  return {
    expectedCount: expectedNumbers.length,
    answeredCount: answeredNumbers.length,
    expectedNumbers,
    answeredNumbers,
    missingNumbers,
    passed: missingNumbers.length === 0,
  };
}

function extractErr(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // ignore
  }
  return err.message || fallback;
}

const TIMELINE_TONE: Record<string, string> = {
  corrigida: 'ok',
  aguardando_correcao: 'accent',
  enviada_por_mim: 'accent',
  em_revisao: 'warm',
  entrega_gerada: 'warm',
  liberada: 'accent',
  bloqueada: 'muted',
};

export default function PucWorkAssistantModal({
  courseId,
  assignmentId,
  isMobile,
  onClose,
  onSwitchAssignment,
  onTriggerDownload,
  onUpdated,
}: PucWorkAssistantModalProps) {
  const [data, setData] = useState<AssistantWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Editor state
  const [markdown, setMarkdown] = useState('');
  const [status, setStatus] = useState<DeliverableStatus>('rascunho');
  const [studentName, setStudentName] = useState('');
  const [groupMembersInput, setGroupMembersInput] = useState('');
  const [myProjectInput, setMyProjectInput] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [provider, setProvider] = useState<'auto' | 'gemini' | 'groq' | 'openrouter'>('auto');
  const [customInstructions, setCustomInstructions] = useState('');

  // Etapa 1: Entendimento ("O que entendi") obrigatória antes de gerar
  const [understanding, setUnderstanding] = useState<UnderstandingSummary | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [manualStatement, setManualStatement] = useState('');
  const [confirmedDivergence, setConfirmedDivergence] = useState(false);
  const [overrideCompleteness, setOverrideCompleteness] = useState(false);

  // Action states
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [publishingGh, setPublishingGh] = useState(false);
  const [togglingKind, setTogglingKind] = useState(false);
  const [mobilePane, setMobilePane] = useState<'editor' | 'brief' | 'timeline'>('editor');

  const loadWorkspace = useCallback(async (preserveError = false) => {
    setLoading(true);
    if (!preserveError) setError('');
    try {
      const res = await api<AssistantWorkspaceResponse>(
        `/puc/assistant/deliverables/${courseId}/${assignmentId}`
      );
      setData(res);
      setMarkdown(res.deliverable?.currentMarkdown || '');
      setStatus(res.deliverable?.status || 'rascunho');
      setOverrideCompleteness(Boolean(res.deliverable?.completenessOverridden));
      setStudentName(res.studentName || '');
      setMyProjectInput(res.course.myProject || '');
      const members =
        res.deliverable?.groupMembers?.length
          ? res.deliverable.groupMembers
          : res.course.groupMembers || [];
      setGroupMembersInput(members.join(', '));
    } catch (err) {
      setError(extractErr(err, 'Não foi possível carregar o Assistente de Trabalhos.'));
    } finally {
      setLoading(false);
    }
  }, [courseId, assignmentId]);

  useEffect(() => {
    setUnderstanding(null);
    setManualStatement('');
    setConfirmedDivergence(false);
    void loadWorkspace();
  }, [loadWorkspace]);

  const localPlaceholders = useMemo(() => findLocalPlaceholders(markdown), [markdown]);
  const hasUnsavedChanges = useMemo(
    () => (data?.deliverable?.currentMarkdown || '') !== markdown,
    [data?.deliverable?.currentMarkdown, markdown]
  );

  const completeness = useMemo(() => {
    const serverComp = data?.deliverable?.completeness || null;
    if (!serverComp || serverComp.expectedNumbers.length === 0) return serverComp;
    return checkLocalCompleteness(serverComp.expectedNumbers, markdown) || serverComp;
  }, [data?.deliverable?.completeness, markdown]);
  const completenessFailed = Boolean(
    completeness && completeness.expectedCount > 0 && !completeness.passed && !overrideCompleteness
  );
  const isHandwritten = Boolean(data?.deliverable?.isHandwritten || understanding?.isHandwritten);
  const isGroup = Boolean(data?.deliverable?.isGroup || understanding?.isGroup);

  const canExportFinal =
    Boolean(data?.deliverable) &&
    (status === 'validada' || status === 'entrega_gerada') &&
    localPlaceholders.length === 0 &&
    !completenessFailed &&
    markdown.trim().length > 0 &&
    !hasUnsavedChanges;

  const canPublishGithub =
    Boolean(data?.deliverable) &&
    status === 'validada' &&
    localPlaceholders.length === 0 &&
    !completenessFailed &&
    markdown.trim().length > 0 &&
    !hasUnsavedChanges;

  const isMultiPart = data?.assignment.assignmentKind === 'multi_part';

  const currentPart = useMemo(
    () => data?.project?.parts.find((p) => p.assignmentId === assignmentId) || null,
    [data?.project, assignmentId]
  );

  const prevPartGraded = useMemo(() => {
    if (!currentPart?.dependsOn || !data?.project) return false;
    const prev = data.project.parts.find((p) => p.assignmentId === currentPart.dependsOn);
    return prev?.timelineState === 'corrigida';
  }, [currentPart, data?.project]);

  const parsedGroupMembers = useMemo(
    () =>
      groupMembersInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [groupMembersInput]
  );

  const handleSaveMyProject = async () => {
    if (savingProject) return;
    setSavingProject(true);
    setError('');
    try {
      await api(`/puc/courses/${courseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ myProject: myProjectInput }),
      });
      setFeedback('Descrição de "Meu projeto" salva para este curso.');
      await loadWorkspace();
    } catch (err) {
      setError(extractErr(err, 'Não foi possível salvar a descrição do seu projeto.'));
    } finally {
      setSavingProject(false);
    }
  };

  // Etapa 1: analisar enunciado + anexos e exibir o card "O que entendi"
  const handleAnalyzeUnderstanding = async (overrideManual?: string) => {
    if (analyzing || !data?.canGenerate) return;
    setAnalyzing(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{ ok: boolean; understanding: UnderstandingSummary }>(
        `/puc/assistant/deliverables/${courseId}/${assignmentId}/understand`,
        {
          method: 'POST',
          body: JSON.stringify({
            manualStatement: (overrideManual ?? manualStatement).trim() || undefined,
          }),
        }
      );
      setUnderstanding(res.understanding);
      setConfirmedDivergence(false);
    } catch (err) {
      setError(extractErr(err, 'Falha ao analisar enunciado e anexos do trabalho.'));
    } finally {
      setAnalyzing(false);
    }
  };

  // Etapa 2: só gera após o usuário clicar em "Confirmar e gerar"
  const handleConfirmAndGenerate = async () => {
    if (generating || !data?.canGenerate || !understanding) return;
    if (!understanding.canProceed && !manualStatement.trim()) {
      setError(
        understanding.blockReason ||
          'Cole o enunciado manualmente antes de confirmar a geração.'
      );
      return;
    }
    if (understanding.titleDivergence.hasDivergence && !confirmedDivergence) {
      setError('Marque a confirmação de divergência entre título e anexo antes de gerar.');
      return;
    }

    setGenerating(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{
        ok: boolean;
        providerLabel: string;
        model: string;
        currentMarkdown: string;
        status: DeliverableStatus;
        visionPagesUsed?: number;
        completeness?: CompletenessCheckResult;
      }>(`/puc/assistant/deliverables/${courseId}/${assignmentId}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          confirmedUnderstanding: true,
          confirmedDivergence,
          manualStatement: manualStatement.trim() || undefined,
          provider,
          instructions: customInstructions,
          studentName,
          groupMembers: understanding.isGroup ? parsedGroupMembers : [],
        }),
      });
      setMarkdown(res.currentMarkdown);
      setStatus(res.status);
      setUnderstanding(null);
      const visionNote = res.visionPagesUsed ? ` · Visão (${res.visionPagesUsed} pág.)` : '';
      const compNote =
        res.completeness && res.completeness.expectedCount > 0
          ? res.completeness.passed
            ? ` · ${res.completeness.answeredCount}/${res.completeness.expectedCount} questões respondidas`
            : ` · Atenção: faltam questões ${res.completeness.missingNumbers.join(', ')}`
          : '';
      setFeedback(
        `Rascunho gerado via ${res.providerLabel} (${res.model})${visionNote}${compNote}. Revise e valide antes de salvar no GitHub.`
      );
      await loadWorkspace();
      onUpdated?.();
    } catch (err) {
      setError(extractErr(err, 'Falha ao gerar entrega.'));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (nextStatus?: DeliverableStatus, saveVersion = false) => {
    if (saving) return;
    const targetStatus: DeliverableStatus =
      nextStatus && nextStatus !== 'entrega_gerada'
        ? nextStatus
        : status === 'entrega_gerada'
          ? 'revisada_por_mim'
          : status;

    if (targetStatus === 'validada' && localPlaceholders.length > 0) {
      setError(
        `Complete os ${localPlaceholders.length} marcador(es) [PREENCHER] antes de validar a entrega.`
      );
      return;
    }
    if (targetStatus === 'validada' && completenessFailed && completeness) {
      setError(
        `Responda a(s) questão(ões) faltante(s) (${completeness.missingNumbers.join(', ')}) antes de validar.`
      );
      return;
    }

    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{
        ok: boolean;
        status: DeliverableStatus;
        githubPublication?: GithubPublicationRecord | null;
        githubWarning?: string | null;
      }>(`/puc/assistant/deliverables/${courseId}/${assignmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          markdown,
          status: targetStatus,
          studentName,
          groupMembers: isGroup ? parsedGroupMembers : [],
          saveVersion,
          overrideCompleteness,
        }),
      });
      setStatus(res.status);
      if (res.githubPublication) {
        setFeedback(
          `Entrega validada e publicada automaticamente no GitHub (v${res.githubPublication.version}) → status atualizado para "Entrega gerada"!`
        );
      } else if (res.githubWarning) {
        setFeedback('Entrega validada (status mantido como "Validada (pronta)" pois o commit no GitHub falhou).');
        setError(`Auto-publicação GitHub falhou: ${res.githubWarning}`);
      } else {
        setFeedback(
          res.status === 'validada'
            ? 'Entrega validada! Agora você pode clicar em "Salvar no GitHub" ou exportar.'
            : saveVersion
              ? 'Nova versão salva no histórico.'
              : 'Alterações salvas.'
        );
      }
      await loadWorkspace(Boolean(res.githubWarning));
      onUpdated?.();
    } catch (err) {
      setError(extractErr(err, 'Erro ao salvar alterações.'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublishGithub = async () => {
    if (publishingGh || !canPublishGithub) return;
    setPublishingGh(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{
        ok: boolean;
        status: DeliverableStatus;
        publication: GithubPublicationRecord;
      }>(`/puc/assistant/deliverables/${courseId}/${assignmentId}/publish-github`, {
        method: 'POST',
      });
      setStatus(res.status);
      setFeedback(
        `Commit confirmado no GitHub privado (v${res.publication.version} · ${res.publication.commitSha.slice(0, 7)})! Status atualizado para "Entrega gerada" (lembre-se de enviar manualmente no Canvas).`
      );
      await loadWorkspace();
      onUpdated?.();
    } catch (err) {
      setError(`Commit no GitHub falhou (status mantido como Validada): ${extractErr(err, 'Erro desconhecido.')}`);
    } finally {
      setPublishingGh(false);
    }
  };

  const handleReviewWithAi = async () => {
    if (reviewing || !markdown.trim()) return;
    setReviewing(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{ ok: boolean; review: ReviewRecord }>(
        `/puc/assistant/deliverables/${courseId}/${assignmentId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            markdown,
            provider: 'auto', // escolhe automaticamente outro provedor diferente do que gerou
          }),
        }
      );
      setFeedback(
        `Revisão concluída por ${res.review.providerLabel} (${res.review.model}): ${res.review.issues.length} ponto(s) levantado(s).`
      );
      await loadWorkspace();
    } catch (err) {
      setError(extractErr(err, 'Não foi possível concluir a revisão com IA.'));
    } finally {
      setReviewing(false);
    }
  };

  const handleToggleMultiPart = async (makeMultiPart: boolean) => {
    if (togglingKind) return;
    setTogglingKind(true);
    setError('');
    try {
      await api(`/puc/assistant/assignments/${courseId}/${assignmentId}/classification`, {
        method: 'PATCH',
        body: JSON.stringify({
          assignmentKind: makeMultiPart ? 'multi_part' : 'one_shot',
        }),
      });
      await loadWorkspace();
      onUpdated?.();
    } catch (err) {
      setError(extractErr(err, 'Erro ao atualizar classificação do trabalho.'));
    } finally {
      setTogglingKind(false);
    }
  };

  const safeDescription = useMemo(
    () => sanitizeCanvasHtml(data?.assignment.description),
    [data?.assignment.description]
  );

  return (
    <div
      className={`puc-modal-backdrop${isMobile ? ' is-sheet' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Assistente de Trabalhos PUC"
      onClick={onClose}
    >
      <div
        className="puc-modal puc-assistant-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="puc-modal-header">
          <div>
            {data && (
              <div className="puc-assistant-badges">
                <span className="puc-course-chip">{data.course.name}</span>
                <span className={`puc-badge tone-${isMultiPart ? 'accent' : 'muted'}`}>
                  {isMultiPart ? 'Projeto multi-parte' : 'Entrega única'}
                </span>
                {data.deliverable && (
                  <span
                    className={`puc-badge tone-${
                      status === 'entrega_gerada' ? 'ok' : status === 'validada' ? 'accent' : 'warm'
                    }`}
                  >
                    {data.deliverable.statusLabel}
                  </span>
                )}
                {data.assignment.deliveryStatus && (
                  <span className="puc-badge tone-muted">
                    Canvas: {data.assignment.deliveryStatus}
                  </span>
                )}
                {isHandwritten && (
                  <span className="puc-badge tone-accent">Modo copiar à mão</span>
                )}
              </div>
            )}
            <h3>{data?.assignment.name || 'Assistente de Trabalhos PUC'}</h3>
          </div>
          <div className="row">
            {data?.assignment.htmlUrl && (
              <a
                href={data.assignment.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn ghost"
              >
                Abrir no Canvas
              </a>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>

        <div className="puc-assistant-body">
          {loading ? (
            <div className="puc-state">Carregando contexto do trabalho...</div>
          ) : !data ? (
            <div className="puc-feedback is-error">{error || 'Trabalho não encontrado.'}</div>
          ) : (
            <>
              {/* Override manual de classificação + aviso de IA desativada */}
              <div className="puc-assistant-topbar">
                <label className="puc-hidden-toggle">
                  <input
                    type="checkbox"
                    checked={isMultiPart}
                    disabled={togglingKind}
                    onChange={(e) => void handleToggleMultiPart(e.target.checked)}
                  />
                  <span>Este trabalho faz parte de um projeto multi-parte</span>
                </label>
                <span className="puc-muted">
                  Prazo: <strong>{formatSaoPauloDateTime(data.assignment.dueAt)}</strong>
                  {data.assignment.pointsPossible !== null
                    ? ` · ${data.assignment.pointsPossible} pts`
                    : ''}
                </span>
              </div>

              {error && (
                <p className="puc-feedback is-error" role="alert">
                  {error}
                </p>
              )}
              {feedback && <p className="puc-feedback is-ok">{feedback}</p>}

              {/* Abas compactas no Mobile */}
              {isMobile && (
                <div className="seg puc-tabs">
                  <button
                    type="button"
                    className={mobilePane === 'editor' ? 'on' : ''}
                    onClick={() => setMobilePane('editor')}
                  >
                    Entrega
                  </button>
                  <button
                    type="button"
                    className={mobilePane === 'brief' ? 'on' : ''}
                    onClick={() => setMobilePane('brief')}
                  >
                    Enunciado
                  </button>
                  {isMultiPart && data.project && (
                    <button
                      type="button"
                      className={mobilePane === 'timeline' ? 'on' : ''}
                      onClick={() => setMobilePane('timeline')}
                    >
                      Linha do tempo
                    </button>
                  )}
                </div>
              )}

              {/* Linha do tempo (SOMENTE para projetos multi-parte) */}
              {isMultiPart && data.project && (!isMobile || mobilePane === 'timeline') && (
                <section className="puc-timeline-card">
                  <div className="puc-item-head">
                    <strong>Linha do tempo — {data.project.title}</strong>
                    <span className="puc-muted">
                      {data.project.parts.length} parte(s) · envio sempre manual no Canvas
                    </span>
                  </div>
                  <div className="puc-timeline-steps">
                    {data.project.parts.map((part) => {
                      const active = part.assignmentId === assignmentId;
                      const tone = TIMELINE_TONE[part.timelineState] || 'muted';
                      return (
                        <button
                          key={part.assignmentId}
                          type="button"
                          className={`puc-timeline-step${active ? ' is-current' : ''}`}
                          onClick={() => onSwitchAssignment(courseId, part.assignmentId)}
                        >
                          <div className="puc-item-head">
                            <span className="puc-muted">Parte {part.order}</span>
                            <span className={`puc-badge tone-${tone}`}>{part.timelineLabel}</span>
                          </div>
                          <strong className="puc-timeline-step-title">{part.name}</strong>
                          <span className="puc-muted">
                            Prazo: {formatSaoPauloDateTime(part.dueAt)}
                          </span>
                          {part.suggestedReviewAt && (
                            <span className="puc-muted">
                              Revisar até: {formatSaoPauloDateTime(part.suggestedReviewAt)}
                            </span>
                          )}
                          {part.score !== null && (
                            <span className="puc-muted">
                              Nota: {part.score}
                              {part.pointsPossible !== null ? `/${part.pointsPossible}` : ''}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Workspace Lado a Lado: Enunciado/Rubrica/Lições | Editor da Entrega */}
              <div className="puc-assistant-split">
                {/* Coluna Esquerda: Enunciado + Rubrica + Lições do professor */}
                {(!isMobile || mobilePane === 'brief') && (
                  <aside className="puc-assistant-brief">
                    <div className="puc-detail-section">
                      <h4>Enunciado</h4>
                      {safeDescription ? (
                        <div
                          className="puc-rich-html"
                          dangerouslySetInnerHTML={{ __html: safeDescription }}
                        />
                      ) : (
                        <p className="puc-muted">Sem descrição cadastrada no Canvas.</p>
                      )}
                    </div>

                    {data.assignment.rubric.length > 0 && (
                      <div className="puc-detail-section">
                        <h4>Rubrica</h4>
                        <ul className="puc-detail-sublist">
                          {data.assignment.rubric.map((crit, idx) => (
                            <li key={crit.id || idx}>
                              <strong>{crit.description}</strong> ({crit.points} pts)
                              {crit.long_description ? ` — ${crit.long_description}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {data.lessons &&
                      ((data.lessons.recurring_issues?.length || 0) > 0 ||
                        (data.lessons.charged_points?.length || 0) > 0) && (
                        <div className="puc-detail-section">
                          <h4>Lições do professor neste curso</h4>
                          <ul className="puc-detail-sublist">
                            {(data.lessons.recurring_issues || []).slice(0, 5).map((item, i) => (
                              <li key={`iss-${i}`}>⚠ {item}</li>
                            ))}
                            {(data.lessons.charged_points || []).slice(0, 4).map((item, i) => (
                              <li key={`chg-${i}`}>• {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* Campo "Meu projeto" por curso (para questões "considerando o seu projeto") */}
                    <div className="puc-detail-section puc-myproject-box">
                      <h4>Meu projeto (neste curso)</h4>
                      <p className="puc-muted">
                        Usado em questões do tipo "considerando o seu projeto". Se ficar vazio, a IA usa apenas suas entregas anteriores ou marca [PREENCHER].
                      </p>
                      <textarea
                        rows={4}
                        placeholder="Descreva brevemente o tema, escopo, arquitetura ou domínio do seu projeto nesta disciplina..."
                        value={myProjectInput}
                        onChange={(e) => setMyProjectInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={savingProject}
                        onClick={() => void handleSaveMyProject()}
                      >
                        {savingProject ? 'Salvando...' : 'Salvar Meu projeto'}
                      </button>
                    </div>

                    {/* Fontes usadas na geração */}
                    {data.deliverable?.usedSources && data.deliverable.usedSources.length > 0 && (
                      <div className="puc-detail-section puc-sources-box">
                        <h4>Fontes usadas na geração ({data.deliverable.usedSources.length})</h4>
                        <ul className="puc-detail-sublist">
                          {data.deliverable.usedSources.map((src, idx) => (
                            <li key={`${src.kind}-${idx}`}>
                              <strong>[{src.kind}]</strong> {src.label}
                              {src.detail ? <span className="puc-muted"> · {src.detail}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </aside>
                )}

                {/* Coluna Direita: Geração (Etapa 1 Entendimento + Etapa 2) + Editor + Revisão IA + Exportação */}
                {(!isMobile || mobilePane === 'editor') && (
                  <section className="puc-assistant-editor-col">
                    {/* Barra de geração (oculta se IA desativada no curso) */}
                    {data.course.aiAllowed ? (
                      <div className="puc-assistant-gen-bar">
                        <div className="puc-assistant-gen-row">
                          <select
                            aria-label="Provedor de IA"
                            value={provider}
                            onChange={(e) => setProvider(e.target.value as any)}
                            disabled={generating || analyzing}
                          >
                            <option value="auto">Provedor: Automático (Gemini p/ visão e longos)</option>
                            <option value="gemini">Gemini</option>
                            <option value="groq">Groq</option>
                            <option value="openrouter">OpenRouter</option>
                          </select>
                          <button
                            type="button"
                            className="btn"
                            disabled={generating || analyzing || !data.canGenerate}
                            onClick={() => void handleAnalyzeUnderstanding()}
                          >
                            {analyzing
                              ? 'Analisando enunciado...'
                              : isMultiPart && prevPartGraded
                                ? 'Gerar entrega da próxima parte'
                                : 'Gerar entrega'}
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Orientações extras opcionais (ex.: foco em arquitetura hexagonal, citar autor X)..."
                          value={customInstructions}
                          onChange={(e) => setCustomInstructions(e.target.value)}
                          disabled={generating || analyzing || !data.canGenerate}
                        />
                        {!data.canGenerate && data.generateBlockedReason && (
                          <p className="puc-feedback is-error">{data.generateBlockedReason}</p>
                        )}
                      </div>
                    ) : (
                      <div className="puc-feedback">
                        IA desativada neste curso (interruptor "IA permitida" desligado).
                      </div>
                    )}

                    {/* ETAPA 1 OBRIGATÓRIA: Card "O que entendi" */}
                    {understanding && (
                      <section className="puc-understanding-card" aria-label="O que entendi">
                        <div className="puc-item-head">
                          <strong>O que entendi — confirme antes de gerar</strong>
                          <button
                            type="button"
                            className="puc-hide-btn"
                            disabled={generating}
                            onClick={() => setUnderstanding(null)}
                          >
                            Cancelar
                          </button>
                        </div>

                        <div className="puc-understanding-grid">
                          <div>
                            <span className="puc-muted">Trabalho (Canvas ID)</span>
                            <strong>
                              {understanding.assignmentName} (#{understanding.assignmentId})
                            </strong>
                          </div>
                          <div>
                            <span className="puc-muted">Formato detectado</span>
                            <strong>
                              {understanding.isHandwritten
                                ? `Manuscrito (${understanding.handwrittenKeywords.join(', ')})`
                                : understanding.detectedFormat}
                            </strong>
                          </div>
                          <div>
                            <span className="puc-muted">Modalidade / Prazo</span>
                            <strong>
                              {understanding.isGroup ? 'Em grupo' : 'Individual'} ·{' '}
                              {formatSaoPauloDateTime(understanding.dueAt)}
                            </strong>
                          </div>
                          <div>
                            <span className="puc-muted">Tipo de entrega (Canvas)</span>
                            <strong>{understanding.submissionTypes.join(', ') || 'Não informado'}</strong>
                          </div>
                          <div>
                            <span className="puc-muted">Questões detectadas</span>
                            <strong>
                              {understanding.questions.total > 0
                                ? `${understanding.questions.total} total (${understanding.questions.closed} fechadas, ${understanding.questions.open} abertas, ${understanding.questions.other} outras)`
                                : 'Sem questões numeradas detectadas'}
                            </strong>
                          </div>
                          <div>
                            <span className="puc-muted">Rubrica / Visão PDF</span>
                            <strong>
                              {understanding.hasRubric ? 'Com rubrica' : 'Sem rubrica'}
                              {understanding.needsVision ? ' · Leitura visual Gemini ativada' : ''}
                            </strong>
                          </div>
                        </div>

                        {/* Anexos lidos */}
                        <div className="puc-understanding-section">
                          <span className="puc-muted">Anexos lidos ({understanding.attachments.length}):</span>
                          {understanding.attachments.length === 0 ? (
                            <p className="puc-muted">Nenhum arquivo anexado no enunciado.</p>
                          ) : (
                            <ul className="puc-detail-sublist">
                              {understanding.attachments.map((att, idx) => (
                                <li key={`${att.name}-${idx}`}>
                                  <strong>{att.name}</strong> — {att.pages} pág. · {att.charsExtracted} caracteres
                                  {att.needsVision ? ' · 👁 Visão Gemini' : ''}
                                  {att.status !== 'ok' ? ` · ⚠ ${att.error || att.status}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Alerta de divergência de título */}
                        {understanding.titleDivergence.hasDivergence && (
                          <div className="puc-placeholder-alert" role="alert">
                            <strong>Divergência entre título do trabalho e anexo:</strong>
                            <p>{understanding.titleDivergence.reason}</p>
                            <label className="puc-hidden-toggle">
                              <input
                                type="checkbox"
                                checked={confirmedDivergence}
                                onChange={(e) => setConfirmedDivergence(e.target.checked)}
                              />
                              <span>Confirmo que o anexo pertence a este trabalho e desejo continuar</span>
                            </label>
                          </div>
                        )}

                        {/* Bloqueio quando anexo está vazio/ilegível + campo manual */}
                        {(!understanding.canProceed || understanding.unreadableAttachments) && (
                          <div className="puc-placeholder-alert" role="alert">
                            <strong>{understanding.blockReason}</strong>
                            <textarea
                              rows={5}
                              className="puc-manual-statement"
                              placeholder="Cole aqui o enunciado completo do trabalho (o assistente nunca vai inventar nem copiar de trabalhos antigos)..."
                              value={manualStatement}
                              onChange={(e) => setManualStatement(e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={analyzing || !manualStatement.trim()}
                              onClick={() => void handleAnalyzeUnderstanding(manualStatement)}
                            >
                              Reanalisar com enunciado colado
                            </button>
                          </div>
                        )}

                        <div className="puc-export-row">
                          <button
                            type="button"
                            className="btn"
                            disabled={
                              generating ||
                              (!understanding.canProceed && !manualStatement.trim()) ||
                              (understanding.titleDivergence.hasDivergence && !confirmedDivergence)
                            }
                            onClick={() => void handleConfirmAndGenerate()}
                          >
                            {generating ? 'Gerando entrega...' : 'Confirmar e gerar'}
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={generating}
                            onClick={() => setUnderstanding(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </section>
                    )}

                    {/* Checagem de completude por questão (em tempo real enquanto edita) */}
                    {completeness && completeness.expectedCount > 0 && (
                      <div
                        className={`puc-completeness-bar ${completeness.passed || overrideCompleteness ? 'is-ok' : 'is-warn'}`}
                        role="status"
                      >
                        <div>
                          <strong>
                            Completude: {completeness.answeredCount}/{completeness.expectedCount} questões respondidas
                          </strong>
                          {!completeness.passed && (
                            <span>
                              {' '}
                              · Não detectadas: {completeness.missingNumbers.join(', ')}
                            </span>
                          )}
                        </div>
                        {!completeness.passed && (
                          <label className="puc-hidden-toggle" style={{ marginTop: 6 }}>
                            <input
                              type="checkbox"
                              checked={overrideCompleteness}
                              onChange={(e) => setOverrideCompleteness(e.target.checked)}
                            />
                            <span>
                              Confirmo que todas as questões reais estão respondidas (liberar validação mesmo com este alerta)
                            </span>
                          </label>
                        )}
                      </div>
                    )}

                    {/* Alerta de marcadores [PREENCHER] */}
                    {localPlaceholders.length > 0 && (
                      <div className="puc-placeholder-alert" role="status">
                        <strong>
                          {localPlaceholders.length} marcador(es) [PREENCHER] pendente(s) — validação e publicação bloqueadas:
                        </strong>
                        <ul>
                          {localPlaceholders.slice(0, 5).map((ph, idx) => (
                            <li key={`${ph}-${idx}`}>{ph}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Metadados da Capa (só pede integrantes se o trabalho for em grupo!) */}
                    {!isHandwritten && (
                      <div className="puc-cover-fields">
                        <input
                          type="text"
                          placeholder="Seu nome (capa do PDF)"
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                        />
                        {isGroup && (
                          <input
                            type="text"
                            placeholder="Integrantes do grupo separados por vírgula"
                            value={groupMembersInput}
                            onChange={(e) => setGroupMembersInput(e.target.value)}
                          />
                        )}
                      </div>
                    )}

                    {/* Alerta de enunciado alterado no Canvas (nunca regera sozinho) */}
                    {data.deliverable?.statementChanged && (
                      <div className="puc-placeholder-alert" role="alert">
                        <div className="puc-item-head">
                          <strong>O enunciado mudou no Canvas após a geração.</strong>
                          {data.course.aiAllowed && (
                            <button
                              type="button"
                              className="btn"
                              disabled={analyzing || generating || !data.canGenerate}
                              onClick={() => void handleAnalyzeUnderstanding()}
                            >
                              Regerar
                            </button>
                          )}
                        </div>
                        <p className="puc-muted" style={{ margin: '4px 0 0' }}>
                          O agente não regerou automaticamente para preservar suas edições. Clique em "Regerar" se quiser gerar novamente.
                        </p>
                      </div>
                    )}

                    {/* Editor Markdown */}
                    <textarea
                      className="puc-markdown-editor"
                      placeholder='Clique em "Gerar entrega" para analisar o enunciado ("O que entendi") e gerar as respostas, ou escreva diretamente aqui...'
                      value={markdown}
                      onChange={(e) => {
                        setMarkdown(e.target.value);
                        if (
                          status === 'rascunho' ||
                          status === 'enviado_a_verificar' ||
                          status === 'entrega_gerada' ||
                          status === 'validada'
                        ) {
                          setStatus('revisada_por_mim');
                        }
                      }}
                    />

                    {/* Controles de Status (enviado a verificar -> revisada -> verificado -> No GitHub), Salvar, Revisar e Exportar */}
                    <div className="puc-assistant-actions">
                      <div className="puc-status-pills">
                        {status === 'enviado_a_verificar' && (
                          <span
                            className="puc-badge tone-accent"
                            title="Publicado pelo agente em pendentes/ no GitHub aguardando sua verificação"
                          >
                            Enviado a verificar
                          </span>
                        )}
                        <button
                          type="button"
                          className={`puc-filter-pill${status === 'rascunho' ? ' is-on' : ''}`}
                          onClick={() => void handleSave('rascunho')}
                          disabled={saving || !markdown.trim()}
                        >
                          Rascunho
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${status === 'revisada_por_mim' ? ' is-on' : ''}`}
                          onClick={() => void handleSave('revisada_por_mim')}
                          disabled={saving || !markdown.trim()}
                        >
                          Revisada por mim
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${status === 'validada' ? ' is-on' : ''}`}
                          onClick={() => void handleSave('validada')}
                          disabled={
                            saving ||
                            !markdown.trim() ||
                            localPlaceholders.length > 0 ||
                            completenessFailed
                          }
                          title={
                            localPlaceholders.length > 0
                              ? 'Remova todos os marcadores [PREENCHER] primeiro'
                              : completenessFailed
                                ? 'Responda todas as questões faltantes primeiro'
                                : 'Marcar entrega como Verificado (libera "Atualizar GitHub")'
                          }
                        >
                          Verificado
                        </button>
                        {status === 'entrega_gerada' && (
                          <span
                            className="puc-badge tone-ok"
                            title="Definido automaticamente após commit confirmado no GitHub. Não envia ao Canvas."
                          >
                            ✓ No GitHub (verificado)
                          </span>
                        )}
                      </div>

                      <div className="puc-export-row">
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={saving || !markdown.trim()}
                          onClick={() => void handleSave(undefined, true)}
                        >
                          {saving ? 'Salvando...' : 'Salvar versão'}
                        </button>
                        {data.course.aiAllowed && (
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={reviewing || !markdown.trim()}
                            onClick={() => void handleReviewWithAi()}
                          >
                            {reviewing ? 'Revisando...' : 'Revisar com IA'}
                          </button>
                        )}

                        {isHandwritten ? (
                          <>
                            <button
                              type="button"
                              className="btn"
                              disabled={!data.deliverable}
                              onClick={() =>
                                void onTriggerDownload(
                                  `/api/puc/assistant/deliverables/${courseId}/${assignmentId}/export.txt`,
                                  `txt-${courseId}-${assignmentId}`
                                )
                              }
                            >
                              Baixar copiar à mão (.txt)
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={!data.deliverable}
                              onClick={() =>
                                void onTriggerDownload(
                                  `/api/puc/assistant/deliverables/${courseId}/${assignmentId}/export-print.html`,
                                  `print-${courseId}-${assignmentId}`,
                                  true
                                )
                              }
                            >
                              Imprimir A4 (copiar à mão)
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            disabled={!canExportFinal}
                            title={
                              !canExportFinal
                                ? 'Salve e marque como "Validada (pronta)" sem [PREENCHER] nem questões faltando'
                                : 'Baixar PDF formatado'
                            }
                            onClick={() =>
                              void onTriggerDownload(
                                `/api/puc/assistant/deliverables/${courseId}/${assignmentId}/export.pdf`,
                                `pdf-${courseId}-${assignmentId}`
                              )
                            }
                          >
                            Exportar PDF
                          </button>
                        )}

                        {data.github?.configured && (
                          <button
                            type="button"
                            className="btn"
                            disabled={!canPublishGithub || publishingGh || Boolean(data.github?.expired)}
                            title={
                              data.github?.expired
                                ? 'Token do GitHub expirado ou inválido — atualize na tela GitHub'
                                : !canPublishGithub
                                  ? 'Marque como "Verificado" (sem alterações não salvas, sem [PREENCHER] e completa) para atualizar no GitHub'
                                  : data.deliverable?.hasPendingGithub
                                    ? 'Commit atômico: move de pendentes/ para a pasta definitiva da matéria'
                                    : 'Publicar commit atômico no GitHub privado'
                            }
                            onClick={() => void handlePublishGithub()}
                          >
                            {publishingGh
                              ? 'Atualizando GitHub...'
                              : data.deliverable?.hasPendingGithub ||
                                  (data.deliverable?.lastPublishedVersion || 0) > 0
                                ? 'Atualizar GitHub'
                                : 'Salvar no GitHub'}
                          </button>
                        )}
                      </div>
                      {data.deliverable?.hasPendingGithub &&
                        (data.deliverable.pendingFolderUrl || data.deliverable.pendingHtmlUrl) && (
                          <div className="puc-export-row">
                            <a
                              href={data.deliverable.pendingFolderUrl || data.deliverable.pendingHtmlUrl || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn ghost"
                            >
                              Ver em pendentes/ (GitHub)
                            </a>
                          </div>
                        )}
                      {data.github?.configured &&
                        (Boolean(data.github?.expired) || (!canPublishGithub && status !== 'entrega_gerada')) &&
                        markdown.trim().length > 0 && (
                          <p className="puc-muted" style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>
                            {data.github?.authError
                              ? `GitHub bloqueado (HTTP ${data.github.authError}): o token foi rejeitado ou não tem permissão Contents (Read and write) neste repositório. Abra o painel "GitHub" no topo da página PUC, teste a conexão e salve novamente.`
                              : data.github?.expired
                                ? 'Token do GitHub expirado ou inválido — abra o painel "GitHub" no topo da página PUC para atualizar o token.'
                                : completenessFailed
                                  ? 'Para liberar "Validada (pronta)" e "Salvar no GitHub", responda as questões faltantes ou marque a confirmação na barra de Completude acima.'
                                  : localPlaceholders.length > 0
                                    ? 'Remova os marcadores [PREENCHER] para validar e salvar no GitHub.'
                                    : status !== 'validada'
                                      ? 'Clique em "Validada (pronta)" acima para liberar o botão "Salvar no GitHub".'
                                      : hasUnsavedChanges
                                        ? 'Há alterações não salvas — clique em "Validada (pronta)" para salvar e liberar "Salvar no GitHub".'
                                        : ''}
                          </p>
                        )}
                      <div className="puc-export-row">
                        {data.deliverable?.lastPublishedUrl && (
                          <a
                            href={data.deliverable.lastPublishedFolderUrl || data.deliverable.lastPublishedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn ghost"
                          >
                            Ver no GitHub (v{data.deliverable.lastPublishedVersion})
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={!data.deliverable}
                          onClick={() =>
                            void onTriggerDownload(
                              `/api/puc/assistant/deliverables/${courseId}/${assignmentId}/export.md`,
                              `md-${courseId}-${assignmentId}`
                            )
                          }
                        >
                          Baixar .md
                        </button>
                        {data.deliverable?.hasCodeFiles && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() =>
                              void onTriggerDownload(
                                `/api/puc/assistant/deliverables/${courseId}/${assignmentId}/export.zip`,
                                `zip-${courseId}-${assignmentId}`
                              )
                            }
                          >
                            Baixar código (.zip)
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Resultado da Revisão com IA (2º passe) */}
                    {data.deliverable?.lastReview && (
                      <div className="puc-review-panel">
                        <div className="puc-item-head">
                          <strong>
                            Revisão com IA ({data.deliverable.lastReview.providerLabel} ·{' '}
                            {data.deliverable.lastReview.model})
                          </strong>
                          <span className="puc-muted">
                            {formatSaoPauloDateTime(data.deliverable.lastReview.reviewedAt)}
                          </span>
                        </div>
                        <p className="puc-review-summary">{data.deliverable.lastReview.summary}</p>
                        {data.deliverable.lastReview.issues.length === 0 ? (
                          <p className="puc-feedback is-ok">Nenhum problema crítico encontrado.</p>
                        ) : (
                          <ul className="puc-review-list">
                            {data.deliverable.lastReview.issues.map((issue, idx) => (
                              <li key={idx} className={`puc-review-item sev-${issue.severity}`}>
                                <div className="puc-item-head">
                                  <strong>
                                    [{issue.category}] {issue.location}
                                  </strong>
                                  <span className={`puc-badge tone-${issue.severity === 'alta' ? 'danger' : 'warm'}`}>
                                    {issue.severity}
                                  </span>
                                </div>
                                <p>{issue.problem}</p>
                                <small className="puc-muted">Sugestão: {issue.suggestion}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Histórico de Publicações no GitHub Privado */}
                    {data.deliverable?.publications && data.deliverable.publications.length > 0 && (
                      <details className="puc-versions-details" open>
                        <summary>
                          Publicações no GitHub ({data.deliverable.publications.length})
                          {data.deliverable.hasUnpublishedChanges ? ' · há alterações não publicadas' : ''}
                        </summary>
                        <ul className="puc-detail-sublist">
                          {[...data.deliverable.publications].reverse().map((pub) => (
                            <li key={pub.commitSha} className="puc-version-row">
                              <span>
                                <strong>v{pub.version}</strong> · <code>{pub.commitSha.slice(0, 7)}</code> ·{' '}
                                {formatSaoPauloDateTime(pub.publishedAt)}
                              </span>
                              <div className="puc-assignment-actions">
                                <a
                                  href={pub.htmlUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="puc-hide-btn"
                                >
                                  Ver commit
                                </a>
                                <a
                                  href={pub.folderUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="puc-hide-btn"
                                >
                                  Ver pasta
                                </a>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {/* Histórico de Versões locais (antes da publicação no GitHub) */}
                    {data.deliverable && data.deliverable.versions.length > 0 && (
                      <details className="puc-versions-details">
                        <summary>
                          Versões salvas ({data.deliverable.versions.length})
                        </summary>
                        <ul className="puc-detail-sublist">
                          {[...data.deliverable.versions].reverse().map((v) => (
                            <li key={v.version} className="puc-version-row">
                              <span>
                                <strong>v{v.version}</strong> · {v.providerLabel} ({v.model}) ·{' '}
                                {formatSaoPauloDateTime(v.createdAt)}
                              </span>
                              <button
                                type="button"
                                className="puc-hide-btn"
                                onClick={() => {
                                  setMarkdown(v.markdown);
                                  setStatus('revisada_por_mim');
                                  setFeedback(`Versão v${v.version} carregada no editor.`);
                                }}
                              >
                                Carregar
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
