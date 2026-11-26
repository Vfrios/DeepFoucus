import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatSaoPauloDateTime, sanitizeCanvasHtml } from '../lib/canvasHtml';

export type DeliverableStatus = 'entrega_gerada' | 'revisada_por_mim' | 'pronta';

interface ProviderOption {
  id: 'gemini' | 'groq' | 'openrouter';
  label: string;
  model: string;
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
  pdfPath: string;
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
    currentMarkdown: string;
    groupMembers: string[];
    versions: DeliverableVersion[];
    publications?: GithubPublicationRecord[];
    lastPublishedUrl?: string | null;
    lastPublishedFolderUrl?: string | null;
    lastPublishedVersion?: number | null;
    lastPublishedAt?: string | null;
    hasUnpublishedChanges?: boolean;
    lastReview: ReviewRecord | null;
    hasCodeFiles: boolean;
    codeFilesCount: number;
    exportGate: {
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
  const [status, setStatus] = useState<DeliverableStatus>('entrega_gerada');
  const [studentName, setStudentName] = useState('');
  const [groupMembersInput, setGroupMembersInput] = useState('');
  const [provider, setProvider] = useState<'auto' | 'gemini' | 'groq' | 'openrouter'>('auto');
  const [customInstructions, setCustomInstructions] = useState('');

  // Action states
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [publishingGh, setPublishingGh] = useState(false);
  const [togglingKind, setTogglingKind] = useState(false);
  const [mobilePane, setMobilePane] = useState<'editor' | 'brief' | 'timeline'>('editor');

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api<AssistantWorkspaceResponse>(
        `/puc/assistant/deliverables/${courseId}/${assignmentId}`
      );
      setData(res);
      setMarkdown(res.deliverable?.currentMarkdown || '');
      setStatus(res.deliverable?.status || 'entrega_gerada');
      setStudentName(res.studentName || '');
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
    void loadWorkspace();
  }, [loadWorkspace]);

  const localPlaceholders = useMemo(() => findLocalPlaceholders(markdown), [markdown]);
  const hasUnsavedChanges = useMemo(
    () => (data?.deliverable?.currentMarkdown || '') !== markdown,
    [data?.deliverable?.currentMarkdown, markdown]
  );

  const canExportPdf =
    Boolean(data?.deliverable) &&
    status === 'pronta' &&
    localPlaceholders.length === 0 &&
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

  const handleGenerate = async () => {
    if (generating || !data?.canGenerate) return;
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
      }>(`/puc/assistant/deliverables/${courseId}/${assignmentId}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          provider,
          instructions: customInstructions,
          studentName,
          groupMembers: parsedGroupMembers,
        }),
      });
      setMarkdown(res.currentMarkdown);
      setStatus(res.status);
      setFeedback(`Entrega gerada via ${res.providerLabel} (${res.model}). Revise antes de exportar.`);
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
    const targetStatus = nextStatus || status;
    if (targetStatus === 'pronta' && localPlaceholders.length > 0) {
      setError(
        `Complete os ${localPlaceholders.length} marcador(es) [PREENCHER] antes de marcar como "Pronta para exportar".`
      );
      return;
    }
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{
        ok: boolean;
        githubPublication?: GithubPublicationRecord | null;
        githubWarning?: string | null;
      }>(`/puc/assistant/deliverables/${courseId}/${assignmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          markdown,
          status: targetStatus,
          studentName,
          groupMembers: parsedGroupMembers,
          saveVersion,
        }),
      });
      setStatus(targetStatus);
      if (res.githubPublication) {
        setFeedback(
          `Entrega marcada como pronta e publicada automaticamente no GitHub (v${res.githubPublication.version})!`
        );
      } else if (res.githubWarning) {
        setFeedback('Entrega marcada como pronta (aviso GitHub abaixo).');
        setError(`Auto-publicação GitHub falhou: ${res.githubWarning}`);
      } else {
        setFeedback(
          targetStatus === 'pronta'
            ? 'Entrega marcada como pronta para exportar!'
            : saveVersion
              ? 'Nova versão salva no histórico.'
              : 'Alterações salvas.'
        );
      }
      await loadWorkspace();
      onUpdated?.();
    } catch (err) {
      setError(extractErr(err, 'Erro ao salvar alterações.'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublishGithub = async () => {
    if (publishingGh || !canExportPdf) return;
    setPublishingGh(true);
    setError('');
    setFeedback('');
    try {
      const res = await api<{ ok: boolean; publication: GithubPublicationRecord }>(
        `/puc/assistant/deliverables/${courseId}/${assignmentId}/publish-github`,
        { method: 'POST' }
      );
      setFeedback(
        `Entrega publicada no GitHub privado (v${res.publication.version} · commit ${res.publication.commitSha.slice(0, 7)})! Versões antigas limpas do Mongo.`
      );
      await loadWorkspace();
      onUpdated?.();
    } catch (err) {
      setError(extractErr(err, 'Falha ao salvar entrega no GitHub.'));
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
                  <span className={`puc-badge tone-${status === 'pronta' ? 'ok' : 'warm'}`}>
                    {data.deliverable.statusLabel}
                  </span>
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
                  </aside>
                )}

                {/* Coluna Direita: Geração + Editor + Revisão IA + Exportação */}
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
                            disabled={generating}
                          >
                            <option value="auto">Provedor: Automático (Gemini p/ longos)</option>
                            <option value="gemini">Gemini</option>
                            <option value="groq">Groq</option>
                            <option value="openrouter">OpenRouter</option>
                          </select>
                          <button
                            type="button"
                            className="btn"
                            disabled={generating || !data.canGenerate}
                            onClick={() => void handleGenerate()}
                          >
                            {generating
                              ? 'Gerando entrega...'
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
                          disabled={generating || !data.canGenerate}
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

                    {/* Alerta de marcadores [PREENCHER] */}
                    {localPlaceholders.length > 0 && (
                      <div className="puc-placeholder-alert" role="status">
                        <strong>
                          {localPlaceholders.length} marcador(es) [PREENCHER] pendente(s) — exportação PDF bloqueada:
                        </strong>
                        <ul>
                          {localPlaceholders.slice(0, 5).map((ph, idx) => (
                            <li key={`${ph}-${idx}`}>{ph}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Metadados da Capa do PDF (Aluno + Integrantes do Grupo) */}
                    <div className="puc-cover-fields">
                      <input
                        type="text"
                        placeholder="Seu nome (capa do PDF)"
                        value={studentName}
                        onChange={(e) => setStudentName(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Integrantes do grupo separados por vírgula (capa do PDF)"
                        value={groupMembersInput}
                        onChange={(e) => setGroupMembersInput(e.target.value)}
                      />
                    </div>

                    {/* Editor Markdown */}
                    <textarea
                      className="puc-markdown-editor"
                      placeholder='Clique em "Gerar entrega" para produzir a entrega pronta em Markdown ou escreva diretamente aqui...'
                      value={markdown}
                      onChange={(e) => {
                        setMarkdown(e.target.value);
                        if (status === 'entrega_gerada') setStatus('revisada_por_mim');
                      }}
                    />

                    {/* Controles de Status, Salvar, Revisar com IA e Exportar */}
                    <div className="puc-assistant-actions">
                      <div className="puc-status-pills">
                        <button
                          type="button"
                          className={`puc-filter-pill${status === 'entrega_gerada' ? ' is-on' : ''}`}
                          onClick={() => void handleSave('entrega_gerada')}
                          disabled={saving || !markdown.trim()}
                        >
                          Entrega gerada
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${status === 'revisada_por_mim' ? ' is-on' : ''}`}
                          onClick={() => void handleSave('revisada_por_mim')}
                          disabled={saving || !markdown.trim()}
                        >
                          Em revisão
                        </button>
                        <button
                          type="button"
                          className={`puc-filter-pill${status === 'pronta' ? ' is-on' : ''}`}
                          onClick={() => void handleSave('pronta')}
                          disabled={saving || !markdown.trim() || localPlaceholders.length > 0}
                          title={
                            localPlaceholders.length > 0
                              ? 'Remova todos os marcadores [PREENCHER] primeiro'
                              : 'Marcar entrega como pronta para exportar'
                          }
                        >
                          Pronta para exportar
                        </button>
                      </div>

                      <div className="puc-export-row">
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={saving || !markdown.trim()}
                          onClick={() => void handleSave(status, true)}
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
                        <button
                          type="button"
                          className="btn"
                          disabled={!canExportPdf}
                          title={
                            !canExportPdf
                              ? 'Salve e marque como "Pronta para exportar" sem nenhum [PREENCHER] pendente'
                              : 'Baixar PDF formatado ABNT'
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
                        {data.github?.configured && (
                          <button
                            type="button"
                            className="btn"
                            disabled={!canExportPdf || publishingGh || Boolean(data.github?.expired)}
                            title={
                              data.github?.expired
                                ? 'Token do GitHub expirado ou inválido — atualize na tela GitHub'
                                : !canExportPdf
                                  ? 'Salve e marque como "Pronta para exportar" sem [PREENCHER] pendente'
                                  : 'Publicar PDF, .md e código no repositório GitHub privado'
                            }
                            onClick={() => void handlePublishGithub()}
                          >
                            {publishingGh ? 'Publicando no GitHub...' : 'Salvar no GitHub'}
                          </button>
                        )}
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
