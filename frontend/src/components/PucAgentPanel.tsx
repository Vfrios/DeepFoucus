import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatSaoPauloDateTime } from '../lib/canvasHtml';

export interface PucAgentStatusResponse {
  config: {
    enabled: boolean;
    paused: boolean;
    activatedAt: string | null;
    maxPerSync: number;
    maxPerDay: number;
    maxPerWeek: number;
    overdueToleranceDays: number;
    preferredProvider: 'auto' | 'gemini' | 'groq' | 'openrouter';
    courseOverrides: Record<string, { enabled: boolean }>;
  };
  quota: {
    todayUsed: number;
    todayLimit: number;
    weekUsed: number;
    weekLimit: number;
    perSyncLimit: number;
  };
  costs: {
    totalEstimatedCostUsd: number;
    byProvider: Array<{
      provider: string;
      generations: number;
      estimatedCostUsd: number;
    }>;
  };
  courses: Array<{
    id: number;
    name: string;
    acronym: string;
    hidden: boolean;
    aiAllowed: boolean;
    agentEnabled: boolean;
  }>;
  decisions: Array<{
    courseId: number;
    assignmentId: number;
    courseName: string;
    courseAcronym: string;
    assignmentName: string;
    dueAt: string | null;
    status: string;
    statusLabel: string;
    reasonCode: string | null;
    reason: string;
    isPossibleQuiz: boolean;
    alwaysIgnore: boolean;
    statementChanged: boolean;
    pendingHtmlUrl: string | null;
    pendingFolderUrl: string | null;
    provider: string | null;
    model: string | null;
    estimatedCostUsd: number | null;
    lastJobId: string | null;
    lastError: string | null;
    updatedAt: string | null;
  }>;
  jobs: Array<{
    jobId: string;
    courseId: number;
    assignmentId: number;
    courseAcronym: string;
    assignmentName: string;
    trigger: string;
    status: string;
    stage: string;
    progress: number;
    attempts: number;
    maxAttempts: number;
    error: string | null;
    telemetry: {
      duration_ms?: number;
      provider?: string | null;
      model?: string | null;
      estimated_cost_usd?: number;
    };
    createdAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
}

interface PucAgentPanelProps {
  onOpenDeliverable: (courseId: number, assignmentId: number) => void;
  onStatusChanged?: (summary: { enabled: boolean; paused: boolean; activeJobs: number }) => void;
  onClose: () => void;
}

type DecisionFilter = 'all' | 'to_verify' | 'queued' | 'ignored' | 'issues';

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

function decisionTone(status: string, isPossibleQuiz: boolean): string {
  if (status === 'no_github') return 'ok';
  if (status === 'enviado_a_verificar' || status === 'verificado') return 'accent';
  if (status === 'gerando' || status === 'na_fila') return 'warm';
  if (status === 'erro' || status === 'precisa_de_voce') return 'danger';
  if (isPossibleQuiz) return 'warm';
  return 'muted';
}

export default function PucAgentPanel({
  onOpenDeliverable,
  onStatusChanged,
  onClose,
}: PucAgentPanelProps) {
  const [data, setData] = useState<PucAgentStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [filter, setFilter] = useState<DecisionFilter>('all');

  // Form state for limits
  const [maxPerSync, setMaxPerSync] = useState(3);
  const [maxPerDay, setMaxPerDay] = useState(8);
  const [maxPerWeek, setMaxPerWeek] = useState(30);
  const [overdueToleranceDays, setOverdueToleranceDays] = useState(7);

  const onStatusChangedRef = useRef(onStatusChanged);
  useEffect(() => {
    onStatusChangedRef.current = onStatusChanged;
  }, [onStatusChanged]);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<PucAgentStatusResponse>('/puc/agent/status');
      setData(res);
      setMaxPerSync(res.config.maxPerSync);
      setMaxPerDay(res.config.maxPerDay);
      setMaxPerWeek(res.config.maxPerWeek);
      setOverdueToleranceDays(res.config.overdueToleranceDays);
      const activeJobs = res.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
      onStatusChangedRef.current?.({
        enabled: res.config.enabled,
        paused: res.config.paused,
        activeJobs,
      });
    } catch (err) {
      setError(extractErr(err, 'Não foi possível carregar o painel do Agente.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const activeJobs = useMemo(
    () => (data?.jobs || []).filter((j) => j.status === 'queued' || j.status === 'running'),
    [data?.jobs]
  );

  // Polling leve enquanto há jobs ativos
  useEffect(() => {
    if (activeJobs.length === 0) return;
    const timer = window.setInterval(() => {
      void loadStatus(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeJobs.length, loadStatus]);

  const updateConfig = async (payload: Record<string, unknown>, key: string, okMsg: string) => {
    setBusyKey(key);
    setError('');
    setFeedback('');
    try {
      await api('/puc/agent/config', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setFeedback(okMsg);
      await loadStatus(true);
    } catch (err) {
      setError(extractErr(err, 'Erro ao salvar configuração do Agente.'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleForceGenerate = async (courseId: number, assignmentId: number, trigger: 'manual_force' | 'retry') => {
    const key = `gen-${courseId}-${assignmentId}`;
    setBusyKey(key);
    setError('');
    setFeedback('');
    try {
      await api(`/puc/agent/assignments/${courseId}/${assignmentId}/force-generate`, {
        method: 'POST',
        body: JSON.stringify({ trigger }),
      });
      setFeedback('Job assíncrono enfileirado. O agente vai gerar e publicar em pendentes/ no GitHub.');
      await loadStatus(true);
    } catch (err) {
      setError(extractErr(err, 'Não foi possível enfileirar a geração.'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleIgnoreAlways = async (courseId: number, assignmentId: number, unignore = false) => {
    const key = `ign-${courseId}-${assignmentId}`;
    setBusyKey(key);
    setError('');
    setFeedback('');
    try {
      await api(
        `/puc/agent/assignments/${courseId}/${assignmentId}/${unignore ? 'unignore' : 'ignore'}`,
        { method: 'POST' }
      );
      setFeedback(unignore ? 'Trabalho removido da lista de ignorados permanentes.' : 'Trabalho marcado para ignorar sempre.');
      await loadStatus(true);
    } catch (err) {
      setError(extractErr(err, 'Erro ao atualizar regra de ignorar.'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    setBusyKey(`cancel-${jobId}`);
    setError('');
    try {
      await api(`/puc/agent/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
      setFeedback('Job cancelado.');
      await loadStatus(true);
    } catch (err) {
      setError(extractErr(err, 'Erro ao cancelar job.'));
    } finally {
      setBusyKey(null);
    }
  };

  const filteredDecisions = useMemo(() => {
    const all = data?.decisions || [];
    if (filter === 'to_verify') {
      return all.filter((d) => d.status === 'enviado_a_verificar' || d.status === 'verificado' || d.statementChanged);
    }
    if (filter === 'queued') {
      return all.filter((d) => d.status === 'na_fila' || d.status === 'gerando');
    }
    if (filter === 'ignored') {
      return all.filter((d) => d.status === 'ignorado');
    }
    if (filter === 'issues') {
      return all.filter((d) => d.status === 'precisa_de_voce' || d.status === 'erro');
    }
    return all;
  }, [data?.decisions, filter]);

  const counts = useMemo(() => {
    const all = data?.decisions || [];
    return {
      all: all.length,
      toVerify: all.filter((d) => d.status === 'enviado_a_verificar' || d.status === 'verificado' || d.statementChanged).length,
      queued: all.filter((d) => d.status === 'na_fila' || d.status === 'gerando').length,
      ignored: all.filter((d) => d.status === 'ignorado').length,
      issues: all.filter((d) => d.status === 'precisa_de_voce' || d.status === 'erro').length,
    };
  }, [data?.decisions]);

  return (
    <section className="puc-ai-box puc-agent-panel" aria-label="Agente de Automação PUC">
      <div className="puc-ai-head">
        <div>
          <strong>Agente de Automação · Assistente de Trabalhos PUC</strong>
          <p className="puc-subtitle">
            Detecta trabalhos novos após o sync leve, gera a entrega em segundo plano, publica em <code>pendentes/</code> no GitHub privado e envia Web Push. Nunca envia nada ao Canvas.
          </p>
        </div>
        <button type="button" className="puc-hide-btn" onClick={onClose}>
          Fechar
        </button>
      </div>

      {error && (
        <p className="puc-feedback is-error" role="alert">
          {error}
        </p>
      )}
      {feedback && <p className="puc-feedback is-ok">{feedback}</p>}

      {loading || !data ? (
        <div className="puc-state">Carregando status do Agente...</div>
      ) : (
        <>
          {/* Controles principais: Ligar/Desligar + Pausar + Cotas + Consumo */}
          <div className="puc-agent-controls">
            <div className="puc-agent-switch-row">
              <label className="puc-hidden-toggle">
                <input
                  type="checkbox"
                  checked={data.config.enabled}
                  disabled={busyKey === 'toggle-enabled'}
                  onChange={(e) =>
                    void updateConfig(
                      { enabled: e.target.checked },
                      'toggle-enabled',
                      e.target.checked
                        ? 'Agente ligado! Somente trabalhos criados a partir de agora serão gerados automaticamente.'
                        : 'Agente desligado.'
                    )
                  }
                />
                <strong>
                  Agente {data.config.enabled ? 'LIGADO' : 'DESLIGADO'}
                </strong>
              </label>

              {data.config.enabled && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busyKey === 'toggle-paused'}
                  onClick={() =>
                    void updateConfig(
                      { paused: !data.config.paused },
                      'toggle-paused',
                      data.config.paused ? 'Agente retomado.' : 'Agente pausado (novos trabalhos ficam na fila).'
                    )
                  }
                >
                  {data.config.paused ? 'Retomar agente' : 'Pausar agente'}
                </button>
              )}

              {data.config.activatedAt && (
                <span className="puc-muted">
                  Ativado em: {formatSaoPauloDateTime(data.config.activatedAt)} (sem retroativo)
                </span>
              )}
            </div>

            {/* Limites e Consumo Estimado */}
            <div className="puc-agent-metrics">
              <div className="puc-agent-metric-card">
                <span className="puc-muted">Cota do dia</span>
                <strong>
                  {data.quota.todayUsed} / {data.quota.todayLimit}
                </strong>
              </div>
              <div className="puc-agent-metric-card">
                <span className="puc-muted">Cota da semana</span>
                <strong>
                  {data.quota.weekUsed} / {data.quota.weekLimit}
                </strong>
              </div>
              <div className="puc-agent-metric-card">
                <span className="puc-muted">Máx. por sync</span>
                <strong>{data.quota.perSyncLimit}</strong>
              </div>
              <div className="puc-agent-metric-card">
                <span className="puc-muted">Consumo estimado</span>
                <strong>US$ {data.costs.totalEstimatedCostUsd.toFixed(4)}</strong>
                {data.costs.byProvider.length > 0 && (
                  <small className="puc-muted">
                    {data.costs.byProvider
                      .map((p) => `${p.provider}: ${p.generations}x ($${p.estimatedCostUsd.toFixed(4)})`)
                      .join(' · ')}
                  </small>
                )}
              </div>
            </div>

            {/* Configuração de Limites e Cursos */}
            <details className="puc-versions-details">
              <summary>Configurar limites de cota e interruptores por curso</summary>
              <div className="puc-agent-limits-grid">
                <label>
                  <span>Máx. por sync</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={maxPerSync}
                    onChange={(e) => setMaxPerSync(Number(e.target.value) || 1)}
                  />
                </label>
                <label>
                  <span>Máx. por dia</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxPerDay}
                    onChange={(e) => setMaxPerDay(Number(e.target.value) || 1)}
                  />
                </label>
                <label>
                  <span>Máx. por semana</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={maxPerWeek}
                    onChange={(e) => setMaxPerWeek(Number(e.target.value) || 1)}
                  />
                </label>
                <label>
                  <span>Tolerância vencidos (dias)</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={overdueToleranceDays}
                    onChange={(e) => setOverdueToleranceDays(Number(e.target.value) || 0)}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={busyKey === 'save-limits'}
                  onClick={() =>
                    void updateConfig(
                      { maxPerSync, maxPerDay, maxPerWeek, overdueToleranceDays },
                      'save-limits',
                      'Limites do agente atualizados.'
                    )
                  }
                >
                  Salvar limites
                </button>
              </div>

              <div className="puc-agent-courses-grid">
                {data.courses
                  .filter((c) => !c.hidden)
                  .map((c) => (
                    <label
                      key={c.id}
                      className="puc-hidden-toggle"
                      title={!c.aiAllowed ? 'IA permitida está desligada neste curso' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={c.agentEnabled}
                        disabled={!c.aiAllowed || busyKey === `course-${c.id}`}
                        onChange={(e) =>
                          void updateConfig(
                            { courseOverride: { courseId: c.id, enabled: e.target.checked } },
                            `course-${c.id}`,
                            `Agente ${e.target.checked ? 'ativado' : 'desativado'} para ${c.acronym}.`
                          )
                        }
                      />
                      <span>
                        <strong>[{c.acronym}]</strong> {c.name}
                        {!c.aiAllowed ? ' (IA desativada)' : ''}
                      </span>
                    </label>
                  ))}
              </div>
            </details>
          </div>

          {/* Jobs Assíncronos Ativos (puc_jobs) */}
          {activeJobs.length > 0 && (
            <div className="puc-sync-progress" role="status" aria-live="polite">
              <div className="puc-sync-progress-head">
                <strong>Jobs em andamento ({activeJobs.length})</strong>
              </div>
              <ul className="puc-list" style={{ marginTop: 8 }}>
                {activeJobs.map((j) => (
                  <li key={j.jobId} className="puc-list-item">
                    <div className="puc-item-head">
                      <span>
                        <strong>[{j.courseAcronym}]</strong> {j.assignmentName}
                      </span>
                      <div className="puc-assignment-actions">
                        <span className="puc-badge tone-warm">
                          {j.stage} ({j.progress}%)
                        </span>
                        <button
                          type="button"
                          className="puc-hide-btn"
                          disabled={busyKey === `cancel-${j.jobId}`}
                          onClick={() => void handleCancelJob(j.jobId)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                    <div className="puc-progress-track" style={{ marginTop: 6 }}>
                      <div className="puc-progress-fill" style={{ width: `${Math.max(8, j.progress)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Filtros de decisões recentes */}
          <div className="puc-filter-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className={`puc-filter-pill${filter === 'all' ? ' is-on' : ''}`}
              onClick={() => setFilter('all')}
            >
              Todas ({counts.all})
            </button>
            <button
              type="button"
              className={`puc-filter-pill${filter === 'to_verify' ? ' is-on' : ''}`}
              onClick={() => setFilter('to_verify')}
            >
              A verificar ({counts.toVerify})
            </button>
            <button
              type="button"
              className={`puc-filter-pill${filter === 'queued' ? ' is-on' : ''}`}
              onClick={() => setFilter('queued')}
            >
              Na fila ({counts.queued})
            </button>
            <button
              type="button"
              className={`puc-filter-pill${filter === 'ignored' ? ' is-on' : ''}`}
              onClick={() => setFilter('ignored')}
            >
              Ignorados pelo agente ({counts.ignored})
            </button>
            <button
              type="button"
              className={`puc-filter-pill${filter === 'issues' ? ' is-on' : ''}`}
              onClick={() => setFilter('issues')}
            >
              Precisa de você / Erros ({counts.issues})
            </button>
          </div>

          {/* Lista de Decisões */}
          {filteredDecisions.length === 0 ? (
            <p className="puc-empty">Nenhuma decisão registrada neste filtro ainda.</p>
          ) : (
            <ul className="puc-list">
              {filteredDecisions.map((d) => {
                const key = `${d.courseId}-${d.assignmentId}`;
                const tone = decisionTone(d.status, d.isPossibleQuiz);
                return (
                  <li key={key} className="puc-list-item">
                    <div className="puc-item-head">
                      <div>
                        <span className="puc-course-chip">[{d.courseAcronym}]</span>{' '}
                        <strong className="puc-item-title">{d.assignmentName}</strong>
                      </div>
                      <div className="puc-assignment-actions">
                        {d.statementChanged && (
                          <span className="puc-badge tone-danger">Enunciado mudou</span>
                        )}
                        {d.isPossibleQuiz && (
                          <span className="puc-badge tone-warm">Possível prova</span>
                        )}
                        <span className={`puc-badge tone-${tone}`}>{d.statusLabel}</span>
                      </div>
                    </div>
                    <p className="puc-muted" style={{ margin: '4px 0' }}>
                      {d.reason}
                      {d.dueAt ? ` · Prazo: ${formatSaoPauloDateTime(d.dueAt)}` : ''}
                      {d.provider ? ` · ${d.provider}/${d.model}` : ''}
                      {typeof d.estimatedCostUsd === 'number' ? ` · ~$${d.estimatedCostUsd.toFixed(4)}` : ''}
                    </p>
                    <div className="puc-assignment-actions" style={{ marginTop: 6 }}>
                      {(d.status === 'enviado_a_verificar' ||
                        d.status === 'verificado' ||
                        d.status === 'no_github' ||
                        d.status === 'precisa_de_voce') && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onOpenDeliverable(d.courseId, d.assignmentId)}
                        >
                          {d.status === 'enviado_a_verificar' ? 'Abrir para verificar' : 'Abrir entrega'}
                        </button>
                      )}
                      {d.statementChanged && (
                        <button
                          type="button"
                          className="btn"
                          disabled={busyKey === `gen-${key}`}
                          onClick={() => void handleForceGenerate(d.courseId, d.assignmentId, 'manual_force')}
                        >
                          Regerar
                        </button>
                      )}
                      {(d.status === 'ignorado' || d.status === 'na_fila' || d.status === 'precisa_de_voce') && (
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={busyKey === `gen-${key}`}
                          onClick={() => void handleForceGenerate(d.courseId, d.assignmentId, 'manual_force')}
                        >
                          Gerar mesmo assim
                        </button>
                      )}
                      {d.status === 'erro' && (
                        <button
                          type="button"
                          className="btn"
                          disabled={busyKey === `gen-${key}`}
                          onClick={() => void handleForceGenerate(d.courseId, d.assignmentId, 'retry')}
                        >
                          Tentar de novo
                        </button>
                      )}
                      {d.alwaysIgnore ? (
                        <button
                          type="button"
                          className="puc-hide-btn"
                          disabled={busyKey === `ign-${key}`}
                          onClick={() => void handleIgnoreAlways(d.courseId, d.assignmentId, true)}
                        >
                          Remover ignorar sempre
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="puc-hide-btn"
                          disabled={busyKey === `ign-${key}`}
                          onClick={() => void handleIgnoreAlways(d.courseId, d.assignmentId, false)}
                        >
                          Ignorar sempre este trabalho
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
