import { useCallback, useEffect, useState } from 'react';
import { useGoogleCalendars } from '../hooks/useGoogleCalendars';
import { api } from '../lib/api';

interface BriefingSectionsToggle {
  weather: boolean;
  calendar: boolean;
  pucDeliveries: boolean;
  pucNews: boolean;
  systemAlerts: boolean;
  tasks: boolean;
}

interface BriefingConfig {
  sections: BriefingSectionsToggle;
  includedCalendarIds: string[];
  ignoredCalendarIds: string[];
  maxItemsPerSection: number;
  minFreeWindowMinutes: number;
  pushEnabled: boolean;
  pushScheduleTime: string;
}

interface BriefingPreview {
  dateKey: string;
  speech: string;
  full: string;
  generatedAt: string;
  cached: boolean;
  aiUsed: boolean;
  aiProvider: string | null;
  aiFallbackReason: string | null;
  failedSources: string[];
  timingsMs: Record<string, number>;
  pushSent: boolean;
}

const SECTION_LABELS: Array<{ key: keyof BriefingSectionsToggle; label: string }> = [
  { key: 'weather', label: 'Clima' },
  { key: 'calendar', label: 'Agenda (Google Calendar)' },
  { key: 'pucDeliveries', label: 'PUC — Entregas e status do agente' },
  { key: 'pucNews', label: 'PUC — Novidades, notas e avisos' },
  { key: 'systemAlerts', label: 'Alertas do sistema (tokens e sync)' },
  { key: 'tasks', label: 'Tarefas (hoje e atrasadas)' },
];

const DEFAULT_CONFIG: BriefingConfig = {
  sections: {
    weather: true,
    calendar: true,
    pucDeliveries: true,
    pucNews: true,
    systemAlerts: true,
    tasks: true,
  },
  includedCalendarIds: [],
  ignoredCalendarIds: [],
  maxItemsPerSection: 5,
  minFreeWindowMinutes: 90,
  pushEnabled: false,
  pushScheduleTime: '',
};

function countWords(text: string): number {
  const clean = text.trim();
  return clean ? clean.split(/\s+/).length : 0;
}

export default function PageBriefing() {
  const { calendars, loading: loadingCalendars } = useGoogleCalendars();
  const [config, setConfig] = useState<BriefingConfig>(DEFAULT_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState('');

  const [preview, setPreview] = useState<BriefingPreview | null>(null);
  const [previewMode, setPreviewMode] = useState<'speech' | 'full'>('speech');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const loadPreview = useCallback(async (refresh = false) => {
    setLoadingPreview(true);
    setPreviewError('');
    try {
      const qs = new URLSearchParams({ format: 'json' });
      if (refresh) qs.set('refresh', '1');
      const data = await api<BriefingPreview>(`/ai/briefing?${qs.toString()}`);
      setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Falha ao carregar o briefing.');
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingConfig(true);
    api<BriefingConfig>('/ai/briefing/config')
      .then((cfg) => {
        if (active) setConfig(cfg);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    void loadPreview(false);
    return () => {
      active = false;
    };
  }, [loadPreview]);

  const handleSave = async () => {
    setSaving(true);
    setSaveFeedback('');
    try {
      const saved = await api<BriefingConfig>('/ai/briefing/config', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
      setConfig(saved);
      setSaveFeedback('Configurações salvas. Clique em "Regerar" para atualizar o texto de hoje.');
    } catch (err) {
      setSaveFeedback(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (key: keyof BriefingSectionsToggle) => {
    setConfig((prev) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections[key] },
    }));
  };

  const toggleIgnoredCalendar = (calId: string) => {
    setConfig((prev) => {
      const ignored = prev.ignoredCalendarIds.includes(calId)
        ? prev.ignoredCalendarIds.filter((id) => id !== calId)
        : [...prev.ignoredCalendarIds, calId];
      return { ...prev, ignoredCalendarIds: ignored, includedCalendarIds: [] };
    });
  };

  const activeText = preview ? (previewMode === 'speech' ? preview.speech : preview.full) : '';
  const words = countWords(activeText);
  const estSeconds = Math.max(1, Math.round(words / 2.6));

  return (
    <div className="briefing-page">
      <header className="briefing-header">
        <div>
          <h1>Briefing da Manhã</h1>
          <p className="briefing-subtitle">
            Pré-visualize o resumo falado pelo iPhone e ajuste seções, calendários e push diário.
          </p>
        </div>
        <div className="briefing-header-actions">
          <button
            type="button"
            className="btn"
            disabled={loadingPreview}
            onClick={() => void loadPreview(true)}
          >
            {loadingPreview ? 'Gerando...' : 'Regerar agora'}
          </button>
        </div>
      </header>

      <div className="briefing-grid">
        {/* ---- Pré-visualização ---- */}
        <section className="briefing-card briefing-preview-card">
          <div className="briefing-card-top">
            <h2>Pré-visualização de hoje</h2>
            <div className="briefing-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === 'speech'}
                className={`briefing-tab${previewMode === 'speech' ? ' is-active' : ''}`}
                onClick={() => setPreviewMode('speech')}
              >
                Falado (speech)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === 'full'}
                className={`briefing-tab${previewMode === 'full' ? ' is-active' : ''}`}
                onClick={() => setPreviewMode('full')}
              >
                Completo (full)
              </button>
            </div>
          </div>

          {previewError && <p className="briefing-error">{previewError}</p>}

          {preview && (
            <>
              <div className="briefing-meta-row">
                <span className="briefing-badge">
                  {preview.cached ? 'Cache do dia' : 'Recém-gerado'}
                </span>
                <span className={`briefing-badge${preview.aiUsed ? ' is-ok' : ' is-warn'}`}>
                  {preview.aiUsed ? `IA: ${preview.aiProvider || 'ativa'}` : 'Fallback determinístico'}
                </span>
                <span className="briefing-badge">
                  {words} palavras (~{estSeconds}s)
                </span>
                {typeof preview.timingsMs?.total === 'number' && (
                  <span className="briefing-badge">{preview.timingsMs.total} ms</span>
                )}
              </div>

              {preview.failedSources.length > 0 && (
                <p className="briefing-warn">
                  Fontes indisponíveis nesta geração: {preview.failedSources.join(', ')}.
                </p>
              )}

              <pre className="briefing-text-box">{activeText}</pre>

              <p className="briefing-timestamp">
                Gerado em {new Date(preview.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {preview.pushSent ? ' · Push diário enviado' : ''}
              </p>
            </>
          )}

          {!preview && loadingPreview && <p className="briefing-muted">Carregando briefing...</p>}
        </section>

        {/* ---- Configurações ---- */}
        <section className="briefing-card briefing-config-card">
          <h2>Configurações</h2>
          {loadingConfig ? (
            <p className="briefing-muted">Carregando preferências...</p>
          ) : (
            <div className="briefing-form">
              <fieldset className="briefing-fieldset">
                <legend>Seções ativas</legend>
                <div className="briefing-checklist">
                  {SECTION_LABELS.map(({ key, label }) => (
                    <label key={key} className="briefing-check">
                      <input
                        type="checkbox"
                        checked={config.sections[key]}
                        onChange={() => toggleSection(key)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="briefing-fieldset">
                <legend>Calendários considerados</legend>
                {loadingCalendars ? (
                  <p className="briefing-muted">Carregando calendários...</p>
                ) : calendars.length === 0 ? (
                  <p className="briefing-muted">Nenhum calendário do Google listado.</p>
                ) : (
                  <div className="briefing-checklist">
                    {calendars.map((cal) => {
                      const included = !config.ignoredCalendarIds.includes(cal.id);
                      return (
                        <label key={cal.id} className="briefing-check">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => toggleIgnoredCalendar(cal.id)}
                          />
                          <span
                            className="briefing-cal-dot"
                            style={{ backgroundColor: cal.backgroundColor }}
                          />
                          <span>{cal.summary}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <div className="briefing-numbers-row">
                <label className="briefing-field">
                  <span>Limite de itens por seção</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={config.maxItemsPerSection}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        maxItemsPerSection: Math.max(1, Math.min(10, Number(e.target.value) || 5)),
                      }))
                    }
                  />
                </label>

                <label className="briefing-field">
                  <span>Janela livre mínima (min)</span>
                  <input
                    type="number"
                    min={30}
                    max={360}
                    step={15}
                    value={config.minFreeWindowMinutes}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        minFreeWindowMinutes: Math.max(30, Math.min(360, Number(e.target.value) || 90)),
                      }))
                    }
                  />
                </label>
              </div>

              <fieldset className="briefing-fieldset">
                <legend>Web Push da manhã (máx. 1 por dia)</legend>
                <label className="briefing-check">
                  <input
                    type="checkbox"
                    checked={config.pushEnabled}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, pushEnabled: e.target.checked }))
                    }
                  />
                  <span>Enviar push único "Bom dia" (abre a página PUC)</span>
                </label>

                {config.pushEnabled && (
                  <label className="briefing-field briefing-time-field">
                    <span>Horário fixo opcional (deixe vazio para enviar na primeira chamada do dia)</span>
                    <input
                      type="time"
                      value={config.pushScheduleTime}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, pushScheduleTime: e.target.value }))
                      }
                    />
                  </label>
                )}
              </fieldset>

              <div className="briefing-save-row">
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? 'Salvando...' : 'Salvar configurações'}
                </button>
                {saveFeedback && <span className="briefing-feedback">{saveFeedback}</span>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
