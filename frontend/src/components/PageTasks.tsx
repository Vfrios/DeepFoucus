import { FormEvent, useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { CorPrioridade, PreviewItem, Task, Tipo, useTasks } from '../hooks/useTasks';
import { useGoogleCalendars } from '../hooks/useGoogleCalendars';
import { api } from '../lib/api';
import { getDefaultTaskColor } from '../lib/taskColors';

// ---------- constantes de UI e Prioridade GitHub ----------

export const PRIORIDADE_CONFIG: Record<
  CorPrioridade,
  { label: string; badge: string; color: string; bg: string; border: string; colorId: string }
> = {
  urgente_hoje: {
    label: 'Urgente',
    badge: 'Urgente · Hoje',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.42)',
    colorId: '11',
  },
  medio_2dias: {
    label: 'Médio',
    badge: 'Médio · 2 dias',
    color: '#f97316',
    bg: 'rgba(249, 115, 22, 0.12)',
    border: 'rgba(249, 115, 22, 0.42)',
    colorId: '6',
  },
  distante_3dias: {
    label: 'Distante',
    badge: 'Distante · 3 dias',
    color: '#eab308',
    bg: 'rgba(234, 179, 8, 0.12)',
    border: 'rgba(234, 179, 8, 0.42)',
    colorId: '5',
  },
  futuro: {
    label: 'Futuro',
    badge: 'Futuro',
    color: '#22c55e',
    bg: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.42)',
    colorId: '2',
  },
};

const PRIORIDADES_ORDEM: CorPrioridade[] = [
  'urgente_hoje',
  'medio_2dias',
  'distante_3dias',
  'futuro',
];

const CORES_TIPO: Record<Tipo, string> = {
  evento: getDefaultTaskColor('evento'),
  estudo: getDefaultTaskColor('estudo'),
  tarefa: getDefaultTaskColor('tarefa'),
  treino: '#c084fc',
};
const LABEL_TIPO: Record<Tipo, string> = {
  evento: 'Evento',
  estudo: 'Estudo',
  tarefa: 'Tarefa',
  treino: 'Treino',
};
const TIPOS: Tipo[] = ['tarefa', 'estudo', 'evento', 'treino'];

type AgendaTab = 'Agenda IA' | 'Plano do Dia' | 'Quadro de Metas';
const AGENDA_TABS: AgendaTab[] = ['Agenda IA', 'Plano do Dia', 'Quadro de Metas'];

type KanbanColumnId = 'a_fazer' | 'em_andamento' | 'concluido';
interface KanbanGoal {
  id: string;
  titulo: string;
  coluna: KanbanColumnId;
  criadoEm?: string;
  prioridade?: CorPrioridade;
}

const KANBAN_COLUMNS: Array<{ id: KanbanColumnId; label: string; accent: string }> = [
  { id: 'a_fazer', label: 'A Fazer', accent: '#9db4ff' },
  { id: 'em_andamento', label: 'Em Andamento', accent: '#f0b95a' },
  { id: 'concluido', label: 'Concluído', accent: '#22c55e' },
];

interface DailyPlanItem {
  ordem: number;
  titulo: string;
  destaque: string;
  horarioSugerido?: string;
  prioridade: CorPrioridade;
  conselho: string;
}

interface DailyPlanResponse {
  ok: boolean;
  plano: string;
  texto?: string;
  itens?: DailyPlanItem[];
}
interface SavedDailyPlanItem { _id: string; texto: string; prioridade: CorPrioridade; feito: boolean; }
interface SavedDailyPlan { _id: string; data: string; itens: SavedDailyPlanItem[]; }

// ---------- Ícones SVG (Sem Emojis) ----------

function AgendaTabIcon({ tab }: { tab: AgendaTab }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      {tab === 'Agenda IA' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
          <path d="M8 3v3M16 3v3M3.5 9.5h17" />
          <path d="m12 12.5 1.1 2.4 2.4 1.1-2.4 1.1L12 19.5l-1.1-2.4-2.4-1.1 2.4-1.1L12 12.5Z" />
        </>
      )}
      {tab === 'Plano do Dia' && (
        <>
          <path d="M12 3a7 7 0 0 1 4.5 12.3c-.7.6-1.2 1.5-1.3 2.4l-.1.8H8.9l-.1-.8c-.1-.9-.6-1.8-1.3-2.4A7 7 0 0 1 12 3Z" />
          <path d="M9.5 21h5" />
        </>
      )}
      {tab === 'Quadro de Metas' && (
        <>
          <rect x="3.5" y="4.5" width="4.5" height="15" rx="1.2" />
          <rect x="9.75" y="4.5" width="4.5" height="10.5" rx="1.2" />
          <rect x="16" y="4.5" width="4.5" height="13" rx="1.2" />
        </>
      )}
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
      <path d="m18.5 15 1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1 1-2.2Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
      <path d="M10 11v5.5M14 11v5.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m14 7-5 5 5 5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m10 7 5 5-5 5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.2 2" />
    </svg>
  );
}

// ---------- utilitários de data ----------

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());

const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromLocalInput = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const formatDateDMY = (isoDate: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};

const maskDateDMY = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const parseDateDMY = (value: string): string | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${yearText}-${monthText}-${dayText}`;
};

function DateInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(formatDateDMY(value));

  useEffect(() => {
    setDraft(formatDateDMY(value));
  }, [value]);

  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      placeholder="DD/MM/AAAA"
      maxLength={10}
      value={draft}
      onChange={(event) => {
        const masked = maskDateDMY(event.target.value);
        setDraft(masked);
        if (!masked) onChange('');
        else {
          const parsed = parseDateDMY(masked);
          if (parsed) onChange(parsed);
        }
      }}
    />
  );
}

const horaValida24h = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

const hhmm = (iso: string | null) =>
iso
  ? new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  : '';

const faixa = (t: Task) => {
  if (!t.inicio) return 'Sem horário';
  const ini = hhmm(t.inicio);
  return t.fim ? `${ini} – ${hhmm(t.fim)}` : ini;
};

function inferirPrioridadeDaTarefa(t: { corPrioridade?: CorPrioridade | null; inicio?: string | null }): CorPrioridade {
  if (t.corPrioridade && PRIORIDADE_CONFIG[t.corPrioridade]) {
    return t.corPrioridade;
  }
  if (!t.inicio) return 'urgente_hoje';
  const d = new Date(t.inicio);
  if (isNaN(d.getTime())) return 'urgente_hoje';
  const hoje = new Date(todayKey() + 'T12:00:00');
  const alvo = new Date(dayKey(d) + 'T12:00:00');
  const diff = Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
  if (diff <= 0) return 'urgente_hoje';
  if (diff <= 2) return 'medio_2dias';
  if (diff === 3) return 'distante_3dias';
  return 'futuro';
}

// ---------- agrupamento da timeline ----------

interface Grupo {
  key: string;
  titulo: string;
  itens: Task[];
  destaque?: boolean;
}

function agrupar(tasks: Task[]): { ativos: Grupo[]; concluidos: Task[] } {
  const ativos: Task[] = [];
  const concluidos: Task[] = [];
  for (const t of tasks) (t.feito ? concluidos : ativos).push(t);

  const hoje = new Date();
  const kHoje = dayKey(hoje);
  const amanha = new Date(hoje);
  amanha.setDate(hoje.getDate() + 1);
  const kAmanha = dayKey(amanha);

  const grupos = new Map<string, Task[]>();
  const semData: Task[] = [];

  for (const t of ativos) {
    if (!t.inicio) {
      semData.push(t);
      continue;
    }
    const d = new Date(t.inicio);
    const k = dayKey(d);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(t);
  }

  for (const arr of grupos.values()) {
    arr.sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
  }
  semData.sort((a, b) => a.titulo.localeCompare(b.titulo));

  const out: Grupo[] = [];
  const chavesOrdenadas = Array.from(grupos.keys()).sort();
  const atrasados: Task[] = [];
  for (const k of chavesOrdenadas) {
    if (k < kHoje) atrasados.push(...grupos.get(k)!);
  }
  if (atrasados.length) {
    out.push({ key: 'atrasado', titulo: 'Atrasado', itens: atrasados });
  }

  if (grupos.has(kHoje)) {
    out.push({ key: kHoje, titulo: 'Hoje', itens: grupos.get(kHoje)!, destaque: true });
  }
  if (grupos.has(kAmanha)) {
    out.push({ key: kAmanha, titulo: 'Amanhã', itens: grupos.get(kAmanha)! });
  }

  const estaSemana: Task[] = [];
  const depois: Task[] = [];
  for (const k of chavesOrdenadas) {
    if (k <= kAmanha) continue;
    const d = new Date(k + 'T12:00:00');
    const diffDias = Math.round((d.getTime() - new Date(kHoje + 'T12:00:00').getTime()) / 86400000);
    if (diffDias <= 7) estaSemana.push(...grupos.get(k)!);
    else depois.push(...grupos.get(k)!);
  }
  if (estaSemana.length) {
    out.push({ key: 'semana', titulo: 'Esta semana', itens: estaSemana });
  }
  if (depois.length) {
    out.push({ key: 'depois', titulo: 'Depois', itens: depois });
  }

  if (semData.length) {
    out.push({ key: 'semdata', titulo: 'Sem data', itens: semData });
  }

  return { ativos: out, concluidos };
}

// ---------- modal de item (criar/editar manual — mantido para compatibilidade com Calendário) ----------

interface ModalProps {
  open: boolean;
  inicial?: Task | null;
  initialStart?: string | null;
  initialEnd?: string | null;
  onSuggest: (prompt: string) => Promise<PreviewItem[]>;
  onClose: () => void;
  onSave: (payload: {
    titulo: string;
    descricao: string;
    tipo: Tipo;
    cor: string;
    corPrioridade?: CorPrioridade | null;
    corPersonalizada: boolean;
    inicio: string | null;
    fim: string | null;
    calendarId: string;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function TaskModal({
  open,
  inicial,
  initialStart,
  initialEnd,
  onSuggest,
  onClose,
  onSave,
  onDelete,
}: ModalProps) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState<Tipo>('tarefa');
  const [corPrioridade, setCorPrioridade] = useState<CorPrioridade>('urgente_hoje');
  const [cor, setCor] = useState('');
  const [corPersonalizada, setCorPersonalizada] = useState(false);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [calendarId, setCalendarId] = useState('primary');
  const { calendars } = useGoogleCalendars();
  const [promptIA, setPromptIA] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [sugestaoMsg, setSugestaoMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const prioInicial = inferirPrioridadeDaTarefa(inicial || { inicio: initialStart });
    setTitulo(inicial?.titulo ?? '');
    setDescricao(inicial?.descricao ?? '');
    setTipo(inicial?.tipo ?? 'tarefa');
    setCorPrioridade(prioInicial);
    setCor(inicial?.cor || PRIORIDADE_CONFIG[prioInicial].color);
    setCorPersonalizada(true);
    setInicio(toLocalInput(inicial?.inicio ?? initialStart ?? null));
    setFim(toLocalInput(inicial?.fim ?? initialEnd ?? null));
    setCalendarId(inicial?.calendarId ?? 'primary');
    setPromptIA('');
    setSugestaoMsg(null);
    setSalvando(false);
    setSugerindo(false);
  }, [open, inicial, initialEnd, initialStart]);

  if (!open) return null;

  const sugerirEvento = async () => {
    const prompt = promptIA.trim();
    if (!prompt || sugerindo) return;
    setSugerindo(true);
    setSugestaoMsg(null);
    try {
      const [suggestion] = await onSuggest(prompt);
      if (!suggestion) {
        setSugestaoMsg({ tipo: 'err', texto: 'A IA não encontrou um evento. Tente descrever de outra forma.' });
        return;
      }
      setTitulo(suggestion.titulo);
      setDescricao(suggestion.descricao);
      setTipo(suggestion.tipo);
      if (suggestion.corPrioridade) {
        setCorPrioridade(suggestion.corPrioridade);
        setCor(PRIORIDADE_CONFIG[suggestion.corPrioridade].color);
      }
      if (suggestion.inicio) setInicio(toLocalInput(suggestion.inicio));
      if (suggestion.fim) setFim(toLocalInput(suggestion.fim));
      setPromptIA('');
      setSugestaoMsg({ tipo: 'ok', texto: 'Sugestão aplicada. Revise os campos e salve.' });
    } catch (error) {
      setSugestaoMsg({
        tipo: 'err',
        texto: `Falha ao consultar a IA: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      });
    } finally {
      setSugerindo(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() || salvando) return;
    setSalvando(true);
    try {
      await onSave({
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        tipo,
        cor: cor || PRIORIDADE_CONFIG[corPrioridade].color || CORES_TIPO[tipo],
        corPrioridade,
        corPersonalizada,
        inicio: fromLocalInput(inicio),
        fim: fromLocalInput(fim),
        calendarId,
      });
      onClose();
    } catch (err: any) {
      setSugestaoMsg({ tipo: 'err', texto: 'Falha ao salvar: ' + (err?.message || 'erro') });
    } finally {
      setSalvando(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-head">
          <h3>{inicial ? 'Editar item' : 'Novo item'}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </button>
        </header>

        <div className="task-ai-prompt">
          <input
            aria-label="Descreva o evento para a IA"
            placeholder="Descreva o evento para preencher com IA..."
            value={promptIA}
            maxLength={1000}
            disabled={sugerindo}
            onChange={(event) => setPromptIA(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void sugerirEvento();
              }
            }}
          />
          <button
            type="button"
            className="btn ghost"
            disabled={sugerindo || !promptIA.trim()}
            onClick={() => void sugerirEvento()}
          >
            <SparkleIcon />
            <span>{sugerindo ? 'Gerando…' : 'IA'}</span>
          </button>
        </div>

        <label className="field">
          <span>Título</span>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={200}
            required
            autoFocus
          />
        </label>

        <div className="field">
          <span>Prioridade</span>
          <div className="agenda-priority-selector" role="group" aria-label="Prioridade da tarefa">
            {PRIORIDADES_ORDEM.map((prio) => {
              const cfg = PRIORIDADE_CONFIG[prio];
              const ativo = corPrioridade === prio;
              return (
                <button
                  key={prio}
                  type="button"
                  className={`agenda-priority-chip${ativo ? ' is-selected' : ''}`}
                  style={
                    {
                      '--prio-color': cfg.color,
                      '--prio-bg': cfg.bg,
                      '--prio-border': cfg.border,
                    } as CSSProperties
                  }
                  aria-pressed={ativo}
                  onClick={() => {
                    setCorPrioridade(prio);
                    setCor(cfg.color);
                    setCorPersonalizada(true);
                  }}
                >
                  <span className="agenda-priority-dot" />
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {LABEL_TIPO[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Salvar no calendário</span>
            <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
              <option value="primary">
                {calendars.find((calendar) => calendar.primary)?.summary || 'Principal'}
              </option>
              {calendars
                .filter((calendar) => !calendar.primary)
                .map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.summary}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="field-row date-time-row">
          <label className="field">
            <span>Início</span>
            <div className="date-time-fields">
              <DateInput
                ariaLabel="Data de início (dia/mês/ano)"
                value={inicio.slice(0, 10)}
                onChange={(date) =>
                  setInicio(date ? `${date}${inicio.slice(10) || 'T09:00'}` : '')
                }
              />
              <input
                aria-label="Hora de início"
                type="text"
                inputMode="numeric"
                lang="pt-BR"
                placeholder="09:00"
                maxLength={5}
                pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                value={inicio.slice(11, 16)}
                onChange={(e) =>
                  setInicio(`${inicio.slice(0, 10) || todayKey()}T${e.target.value}`)
                }
              />
            </div>
          </label>
          <label className="field">
            <span>Fim</span>
            <div className="date-time-fields">
              <DateInput
                ariaLabel="Data de fim (dia/mês/ano)"
                value={fim.slice(0, 10)}
                onChange={(date) =>
                  setFim(date ? `${date}${fim.slice(10) || 'T10:00'}` : '')
                }
              />
              <input
                aria-label="Hora de fim"
                type="text"
                inputMode="numeric"
                lang="pt-BR"
                placeholder="10:00"
                maxLength={5}
                pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                value={fim.slice(11, 16)}
                onChange={(e) =>
                  setFim(`${fim.slice(0, 10) || inicio.slice(0, 10) || todayKey()}T${e.target.value}`)
                }
              />
            </div>
          </label>
        </div>

        <label className="field">
          <span>Descrição</span>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </label>

        {sugestaoMsg && (
          <p className={`ai-feedback ${sugestaoMsg.tipo}`} role="status">
            {sugestaoMsg.texto}
          </p>
        )}

        <footer className="modal-foot">
          {inicial && onDelete ? <button type="button" className="icon-btn agenda-delete-btn" aria-label="Excluir item" title="Excluir" disabled={excluindo || salvando} onClick={async () => { if (!window.confirm(`Excluir ${titulo}?`)) return; setExcluindo(true); try { await onDelete(); onClose(); } finally { setExcluindo(false); } }}><TrashIcon /></button> : <div style={{ flex: 1 }} />}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={salvando || !titulo.trim()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}

// ---------- Modal de Revisão da IA (z-index: 9999) ----------

interface PreviewModalProps {
  open: boolean;
  itens: PreviewItem[];
  onClose: () => void;
  onConfirm: (itens: PreviewItem[]) => Promise<void>;
}

  function PreviewDateTimeField({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string | null;
    onChange: (value: string | null) => void;
  }) {
    const localValue = toLocalInput(value);
    const [dia, setDia] = useState(localValue.slice(0, 10) || todayKey());
    const [hora, setHora] = useState(localValue.slice(11, 16) || '09:00');

    useEffect(() => {
    const nextLocal = toLocalInput(value);
    setDia(nextLocal.slice(0, 10) || todayKey());
    setHora(nextLocal.slice(11, 16) || '09:00');
  }, [value]);

const atualizar = (nextDia: string, nextHora: string) => {
  if (!nextDia) {
    onChange(null);
    return;
  }
  if (horaValida24h(nextHora)) {
    const iso = fromLocalInput(`${nextDia}T${nextHora}`);
    if (iso) onChange(iso);
  }
};

return (
    <label className="agenda-review-datetime">
      <span>{label}</span>
      <div className="agenda-review-datetime-inputs">
        <input
          type="date"
          aria-label={`Data de ${label.toLocaleLowerCase('pt-BR')}`}
          value={dia}
          onChange={(e) => {
            const nextDia = e.target.value;
            setDia(nextDia);
            atualizar(nextDia, horaValida24h(hora) ? hora : '09:00');
          }}
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="09:00"
          maxLength={5}
          aria-label={`Hora de ${label.toLocaleLowerCase('pt-BR')}`}
          value={hora}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d:]/g, '').slice(0, 5);
            const masked =
              raw.length === 4 && !raw.includes(':') ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
            setHora(masked);
            atualizar(dia, masked);
          }}
        />
      </div>
    </label>
);
}

function PreviewModal({ open, itens, onClose, onConfirm }: PreviewModalProps) {
  const [editaveis, setEditaveis] = useState<PreviewItem[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (open) {
      setEditaveis(
        itens.map((item) => {
          const prio = inferirPrioridadeDaTarefa(item);
          return {
            ...item,
            corPrioridade: prio,
            cor: PRIORIDADE_CONFIG[prio].color,
            colorId: PRIORIDADE_CONFIG[prio].colorId,
          };
        })
      );
      setErro('');
    }
    setConfirmando(false);
  }, [open, itens]);

  if (!open) return null;

  const patch = (idx: number, p: Partial<PreviewItem>) =>
    setEditaveis((arr) => arr.map((it, i) => (i === idx ? { ...it, ...p } : it)));

  const remover = (idx: number) => setEditaveis((arr) => arr.filter((_, i) => i !== idx));

  const confirmar = async () => {
    if (confirmando || editaveis.length === 0) return;
    setConfirmando(true);
    setErro('');
    try {
      await onConfirm(editaveis);
      onClose();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha ao confirmar e agendar os itens.');
    } finally {
      setConfirmando(false);
    }
  };

  return createPortal(
            <div
              className="review-overlay review-modal-backdrop agenda-review-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && !confirmando) onClose();
              }}
            >
              <div className="review-modal agenda-review-modal" role="dialog" aria-modal="true" aria-labelledby="agenda-review-title">
                <header className="review-header">
                  <div>
                    <p className="calendar-eyebrow">REVISÃO INTELIGENTE</p>
                    <h2 id="agenda-review-title">Revisar Tarefas Sugeridas pela IA</h2>
                    <p className="review-sub">
                      Horários calculados após o café da manhã (09:00) e cruzados com o Google Calendar. Ajuste antes de agendar.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="review-close"
                    onClick={onClose}
                    disabled={confirmando}
                    aria-label="Fechar revisão"
                  >
                    <CloseIcon />
                  </button>
                </header>

                <div className="review-body">
                  {erro && (
                    <p className="health-message is-error" role="alert">
                      {erro}
                    </p>
                  )}

                  {editaveis.length === 0 ? (
                    <p className="health-empty">Nenhuma tarefa restante na revisão.</p>
                  ) : (
                    <div className="agenda-review-list">
                      {editaveis.map((it, i) => {
                        const prio = it.corPrioridade || 'urgente_hoje';
                        const cfg = PRIORIDADE_CONFIG[prio];
                        return (
                  <article
                    key={i}
                    className="agenda-review-card"
                    style={
                      {
                        '--card-prio-color': cfg.color,
                        '--card-prio-bg': cfg.bg,
                        '--card-prio-border': cfg.border,
                      } as CSSProperties
                    }
                  >
                    <div className="agenda-review-card-top">
                      <label className="agenda-review-title-field">
                        <span>Título</span>
                        <input
                          aria-label="Título da tarefa"
                          value={it.titulo}
                          maxLength={200}
                          placeholder="Título da tarefa"
                          onChange={(e) => patch(i, { titulo: e.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="agenda-trash-btn"
                        aria-label={`Remover ${it.titulo || 'tarefa'}`}
                        title="Remover tarefa"
                        onClick={() => remover(i)}
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    <div className="agenda-review-card-times">
                      <PreviewDateTimeField
                        label="Início"
                        value={it.inicio}
                        onChange={(inicio) => patch(i, { inicio })}
                      />
                      <PreviewDateTimeField
                        label="Fim"
                        value={it.fim}
                        onChange={(fim) => patch(i, { fim })}
                      />
                    </div>

                    <div className="agenda-review-priority-row">
                      <span className="agenda-review-priority-label">Prioridade</span>
                      <div className="agenda-priority-selector" role="group" aria-label="Seletor de prioridade">
                        {PRIORIDADES_ORDEM.map((pKey) => {
                          const pCfg = PRIORIDADE_CONFIG[pKey];
                          const selected = prio === pKey;
                          return (
                            <button
                              key={pKey}
                              type="button"
                              className={`agenda-priority-chip${selected ? ' is-selected' : ''}`}
                              style={
                                {
                                  '--prio-color': pCfg.color,
                                  '--prio-bg': pCfg.bg,
                                  '--prio-border': pCfg.border,
                                } as CSSProperties
                              }
                              aria-pressed={selected}
                              onClick={() =>
                                patch(i, {
                                  corPrioridade: pKey,
                                  cor: pCfg.color,
                                  colorId: pCfg.colorId,
                                })
                              }
                            >
                              <span className="agenda-priority-dot" />
                              <span>{pCfg.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="review-footer">
          <button type="button" className="btn ghost" disabled={confirmando} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn review-save"
            disabled={confirmando || editaveis.length === 0 || editaveis.some((it) => !it.titulo.trim())}
            onClick={confirmar}
          >
            <CheckIcon />
            <span>{confirmando ? 'Agendando…' : 'Confirmar e Agendar'}</span>
          </button>
        </footer>
      </div>
    </div>,
                document.body
                );
}

                // ---------- Linha de tarefa agendada ----------

                function TaskRow({
                  task,
                  onToggle,
                  onEdit,
                  onRemove,
}: {
                  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const prio = inferirPrioridadeDaTarefa(task);
                const prioCfg = PRIORIDADE_CONFIG[prio];

                return (
                  <li
                    className={`task-row agenda-task-row${task.feito ? ' done' : ''}`}
                    style={
                      {
                        '--task-prio-color': prioCfg.color,
                        '--task-prio-bg': prioCfg.bg,
                        '--task-prio-border': prioCfg.border,
                      } as CSSProperties
                    }
                  >
                    <button
                      type="button"
                      className="check"
                      onClick={onToggle}
                      aria-label={task.feito ? 'Reabrir tarefa' : 'Concluir tarefa'}
                    >
                      {task.feito && <CheckIcon />}
                    </button>
                    <span
                      className="type-bar"
                      style={{ background: prioCfg.color }}
                      aria-hidden="true"
                    />
                    <div className="task-row-body" onClick={onEdit} role="button" tabIndex={0}>
                      <div className="task-row-top">
                        <span className="cal-item-time">
                          <ClockIcon />
                          <span>{faixa(task)}</span>
                        </span>
                        <span
                          className="agenda-prio-badge"
                          style={{
                            color: prioCfg.color,
                            backgroundColor: prioCfg.bg,
                            borderColor: prioCfg.border,
                          }}
                        >
                          <span className="agenda-priority-dot" style={{ backgroundColor: prioCfg.color }} />
                          {prioCfg.badge}
                        </span>
                        <span
                          className="type-tag"
                          style={{ color: CORES_TIPO[task.tipo], borderColor: CORES_TIPO[task.tipo] }}
                        >
                          {LABEL_TIPO[task.tipo]}
                        </span>
                      </div>
                      <strong className="task-row-title">{task.titulo}</strong>
                      {task.descricao && <p className="task-row-desc">{task.descricao}</p>}
                    </div>
                      <button
                        type="button"
                        className="icon-btn agenda-delete-btn"
                        onClick={onRemove}
                        aria-label={`Excluir ${task.titulo}`}
                        title="Excluir"
                      >
                        <TrashIcon />
                      </button>
                  </li>
                  );
}

                  // ---------- Página Principal: Centro de Comando da Agenda ----------

                  export default function PageTasks() {
  const {
                    tasks,
                    error,
                    create,
                    update,
                    toggle,
                    remove,
                    previewFromIA,
                    confirmFromIA,
                    refetch: refetchTasks,
  } = useTasks();

                  const [tab, setTab] = useState<AgendaTab>('Agenda IA');

                    // Modal manual (criar/editar)
                    const [modalOpen, setModalOpen] = useState(false);
                    const [editando, setEditando] = useState<Task | null>(null);

                    // Aba 1: Agenda IA
                    const [roteiro, setRoteiro] = useState('');
                    const [gerando, setGerando] = useState(false);
                    const [previewAberto, setPreviewAberto] = useState(false);
                    const [previewItens, setPreviewItens] = useState<PreviewItem[]>([]);
                    const [iaMsg, setIaMsg] = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null);

                    // Aba 2: Plano do Dia
                    const [dailyInput, setDailyInput] = useState('');
                    const [dailyLoading, setDailyLoading] = useState(false);
                    const [dailyPlan, setDailyPlan] = useState<DailyPlanResponse | null>(null);
                    const [dailyError, setDailyError] = useState('');
                    const [savedDailyPlan, setSavedDailyPlan] = useState<SavedDailyPlan | null>(null);
                    const [dailySaving, setDailySaving] = useState(false);
                    const [briefingLoading, setBriefingLoading] = useState(false);

                    // Aba 3: Quadro de Metas (Kanban)
                    const [kanbanGoals, setKanbanGoals] = useState<KanbanGoal[]>([]);
                    const [kanbanLoading, setKanbanLoading] = useState(false);
                    const [kanbanSaving, setKanbanSaving] = useState(false);
                    const [newGoalTitle, setNewGoalTitle] = useState('');
                    const [draggingGoalId, setDraggingGoalId] = useState<string | null>(null);
                    const [dragOverCol, setDragOverCol] = useState<KanbanColumnId | null>(null);

                    const {ativos, concluidos} = useMemo(() => agrupar(tasks), [tasks]);

  // Carrega o Kanban salvo no perfil ao iniciar
  useEffect(() => {
                      let active = true;
                    setKanbanLoading(true);
                    api<{ ok: boolean; kanban_goals: KanbanGoal[] }>('/tasks/kanban')
      .then((res) => {
        if (active && Array.isArray(res.kanban_goals)) {
                      setKanbanGoals(res.kanban_goals);
        }
      })
      .catch(() => {
                      // silencioso se ainda não houver metas
                    })
      .finally(() => {
        if (active) setKanbanLoading(false);
      });
    return () => {
                      active = false;
    };
  }, []);

  useEffect(() => {
    api<SavedDailyPlan | null>('/daily-plans').then(setSavedDailyPlan).catch(() => {});
  }, []);

  const persistKanban = useCallback(async (nextGoals: KanbanGoal[]) => {
                      setKanbanGoals(nextGoals);
                    setKanbanSaving(true);
                    try {
                      await api('/tasks/kanban', {
                        method: 'PUT',
                        body: JSON.stringify({ kanban_goals: nextGoals }),
                      });
    } catch {
                      setIaMsg({ tipo: 'err', msg: 'Não foi possível sincronizar o Quadro de Metas.' });
    } finally {
                      setKanbanSaving(false);
    }
  }, []);

  const abrirNovo = () => {
                      setEditando(null);
                    setModalOpen(true);
  };

  const abrirEditar = (t: Task) => {
                      setEditando(t);
                    setModalOpen(true);
  };

                    const salvar = async (payload: {
                      titulo: string;
                    descricao: string;
                    tipo: Tipo;
                    cor: string;
                    corPrioridade?: CorPrioridade | null;
                    corPersonalizada: boolean;
                    inicio: string | null;
                    fim: string | null;
                    calendarId: string;
  }) => {
    if (editando) await update(editando._id, payload);
                    else await create(payload);
  };

  // Aba 1: Analisar com IA -> preview-ai
  const gerarPreview = async () => {
    if (!roteiro.trim() || gerando) return;
                    setGerando(true);
                    setIaMsg(null);
                    try {
      const itens = await previewFromIA(roteiro);
                    if (!itens.length) {
                    setIaMsg({tipo: 'err', msg: 'A IA não identificou tarefas agendáveis nesse texto.' });
                    return;
      }
                    setPreviewItens(itens);
                    setPreviewAberto(true);
    } catch (e: any) {
                    setIaMsg({tipo: 'err', msg: 'Falha ao analisar com IA: ' + (e?.message || 'erro') });
    } finally {
                      setGerando(false);
    }
  };

  // Aba 1: Confirmar revisão -> POST /api/tasks/confirm
  const confirmarPreview = async (itens: PreviewItem[]) => {
                    const res = await confirmFromIA(itens);
                    await refetchTasks();
                    const refreshedKanban = await api<{ ok: boolean; kanban_goals: KanbanGoal[] }>('/tasks/kanban');
                    setKanbanGoals(refreshedKanban.kanban_goals || []);
                    setRoteiro('');
                    setIaMsg({
                      tipo: 'ok',
                    msg: 'Tarefas adicionadas ao Plano do Dia e Kanban. Agenda sincronizada com o Google Calendar.',
    });
  };

  // Aba 2: Plano do Dia -> POST /api/ai/daily-plan
  const analisarPlanoDoDia = async () => {
    const texto = dailyInput.trim();
                    if (!texto || dailyLoading) return;
                    setDailyLoading(true);
                    setDailyError('');
                    try {
      const res = await api<DailyPlanResponse>('/ai/daily-plan', {
                      method: 'POST',
                      body: JSON.stringify({texto}),
      });
                      setDailyPlan(res);
    } catch (e: any) {
                        setDailyError(e instanceof Error ? e.message : 'Não foi possível gerar o Plano do Dia.');
    } finally {
                        setDailyLoading(false);
    }
  };

  const salvarPlanoDoDia = async () => {
    if (!dailyPlan || dailySaving) return;
    const itens = dailyPlan.itens?.length
      ? dailyPlan.itens.map((item) => ({ texto: [item.titulo, item.conselho].filter(Boolean).join(' — '), prioridade: item.prioridade, feito: false }))
      : (dailyPlan.plano || dailyPlan.texto || '').split(/\r?\n/).filter((line) => line.trim()).map((texto) => ({ texto: texto.trim(), prioridade: 'futuro' as CorPrioridade, feito: false }));
    setDailySaving(true);
    try {
      setSavedDailyPlan(await api<SavedDailyPlan>('/daily-plans', { method: 'POST', body: JSON.stringify({ itens }) }));
    } catch (cause) { setDailyError(cause instanceof Error ? cause.message : 'Não foi possível salvar o plano.'); }
    finally { setDailySaving(false); }
  };

  const editarItemPlano = async (item: SavedDailyPlanItem, patch: Partial<SavedDailyPlanItem>) => {
    if (!savedDailyPlan) return;
    setSavedDailyPlan(await api<SavedDailyPlan>(`/daily-plans/${savedDailyPlan._id}`, { method: 'PATCH', body: JSON.stringify({ itemId: item._id, ...patch }) }));
  };
  const excluirItemPlano = async (item: SavedDailyPlanItem) => {
    if (!savedDailyPlan) return;
    setSavedDailyPlan(await api<SavedDailyPlan>(`/daily-plans/${savedDailyPlan._id}?itemId=${encodeURIComponent(item._id)}`, { method: 'DELETE' }));
  };

  // Aba 3: Funções do Kanban
  const ouvirBriefing = async () => {
    if (briefingLoading) return;
    setBriefingLoading(true);
    setDailyError('');
    try {
      const position = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 10 * 60 * 1000,
        });
      });
      const params = new URLSearchParams();
      if (position) {
        params.set('lat', String(position.coords.latitude));
        params.set('lon', String(position.coords.longitude));
      }
      const result = await api<{ texto: string }>(`/ai/briefing?${params.toString()}`);
      window.speechSynthesis.cancel();
      result.texto.split('\n\n').map((block) => block.trim()).filter(Boolean).forEach((block) => {
        const utterance = new SpeechSynthesisUtterance(block);
        utterance.lang = 'pt-BR';
        window.speechSynthesis.speak(utterance);
      });
    } catch (cause) {
      setDailyError(cause instanceof Error ? cause.message : 'Não foi possível reproduzir o briefing.');
    } finally {
      setBriefingLoading(false);
    }
  };

  const adicionarMetaKanban = (e: FormEvent) => {
                        e.preventDefault();
                      const titulo = newGoalTitle.trim();
                      if (!titulo) return;
                      const nova: KanbanGoal = {
                        id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      titulo,
                      coluna: 'a_fazer',
                      criadoEm: new Date().toISOString(),
    };
                      setNewGoalTitle('');
                      void persistKanban([...kanbanGoals, nova]);
  };

  const moverMetaKanban = (id: string, novaColuna: KanbanColumnId) => {
    const atualizadas = kanbanGoals.map((g) => (g.id === id ? {...g, coluna: novaColuna } : g));
                      void persistKanban(atualizadas);
  };

  const removerMetaKanban = (id: string) => {
    const atualizadas = kanbanGoals.filter((g) => g.id !== id);
                      void persistKanban(atualizadas);
  };

                      const handleDragStart = (e: DragEvent<HTMLElement>, goalId: string) => {
                        setDraggingGoalId(goalId);
                        e.dataTransfer.setData('text/plain', goalId);
                        e.dataTransfer.effectAllowed = 'move';
  };

                        const handleDropColumn = (e: DragEvent<HTMLElement>, colId: KanbanColumnId) => {
                          e.preventDefault();
                          setDragOverCol(null);
                          const id = e.dataTransfer.getData('text/plain') || draggingGoalId;
                          setDraggingGoalId(null);
                          if (!id) return;
    const goal = kanbanGoals.find((g) => g.id === id);
                          if (goal && goal.coluna !== colId) {
                            moverMetaKanban(id, colId);
    }
  };

  const pendentesCount = tasks.filter((t) => !t.feito).length;

                          return (
                            <main className="page health-page tasks-command-page">
                              <header className="health-top">
                                <div className="health-title">
                                  <p className="calendar-eyebrow">CENTRO DE COMANDO</p>
                                  <h1 className="page-title">Agenda</h1>
                                </div>

                                    <div className="health-tabs" role="tablist" aria-label="Seções da Agenda">
                                      {AGENDA_TABS.map((name) => (
                                        <button
                                          key={name}
                                          type="button"
                                          role="tab"
                                          aria-selected={tab === name}
                                          className="health-tab"
                                          onClick={() => setTab(name)}
                                        >
                                          <AgendaTabIcon tab={name} />
                                          <span>{name}</span>
                                        </button>
                                      ))}
                                    </div>

                                <div className="health-profile-summary">
                                  <span>{pendentesCount} pendente(s)</span>
                                </div>
                              </header>

      {(error || iaMsg) && (
                                <p
                                  className={`health-message${error || iaMsg?.tipo === 'err' ? ' is-error' : ''}`}
                                  role={error || iaMsg?.tipo === 'err' ? 'alert' : 'status'}
                                >
                                  {error || iaMsg?.msg}
                                </p>
                              )}

                              <div className={`health-tab-body${tab === 'Quadro de Metas' ? ' is-kanban' : ''}`}>
                                {/* ==================== ABA 1: AGENDA IA ==================== */}
                                {tab === 'Agenda IA' && (
                                  <section className="agenda-ia-layout" role="tabpanel" aria-label="Agenda IA">
                                    <article className="health-panel agenda-ia-composer">
                                      <div className="health-section-heading">
                                        <div>
                                          <h2>Agendador Inteligente</h2>
                                          <p>
                                            Respeita o fim do café da manhã (09:00), turnos da tarde (14:00+) e eventos do Google Calendar.
                                          </p>
                                        </div>
                                        <button type="button" className="btn ghost" onClick={abrirNovo}>
                                          <PlusIcon />
                                          <span>Nova Tarefa</span>
                                        </button>
                                      </div>

              <textarea
                value={roteiro}
                onChange={(e) => setRoteiro(e.target.value)}
                placeholder="Descreva suas tarefas em linguagem natural: 'De manhã estudar Cálculo e revisar Física. À tarde pagar conta urgente e organizar relatório.'"
                rows={4}
                maxLength={4000}
                className="agenda-ia-textarea"
              />

                                      <div className="agenda-ia-composer-foot">
                                        <div className="agenda-legend-pills" aria-label="Legenda de prioridades">
                                          {PRIORIDADES_ORDEM.map((pKey) => {
                                            const cfg = PRIORIDADE_CONFIG[pKey];
                                            return (
                                              <span key={pKey} className="agenda-legend-pill">
                                                <i style={{ backgroundColor: cfg.color }} />
                                                {cfg.badge}
                                              </span>
                                            );
                                          })}
                                        </div>

                                        <button
                                          type="button"
                                          className={`btn health-generate-button agenda-analyze-btn${gerando ? ' is-loading' : ''}`}
                                          disabled={gerando || !roteiro.trim()}
                                          onClick={gerarPreview}
                                        >
                                          {gerando ? (
                                            <>
                                              <span className="health-spinner" /> Analisando…
                                            </>
                                          ) : (
                                            <>
                                              <SparkleIcon />
                                              <span>Analisar com IA</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    </article>

                                    <article className="health-panel agenda-ia-list-panel">
                                      <div className="health-section-heading">
                                        <div>
                                          <h2>Tarefas Agendadas</h2>
                                          <p>Sincronizadas com o Google Calendar e classificadas por prioridade.</p>
                                        </div>
                                      </div>

                                      <div className="agenda-timeline-scroll">
                                        {ativos.length === 0 && concluidos.length === 0 ? (
                                          <p className="health-empty">
                                            Nenhuma tarefa agendada. Descreva sua rotina acima e clique em Analisar com IA.
                                          </p>
                                        ) : (
                                          <>
                                            {ativos.map((g) => (
                                              <section
                                                key={g.key}
                                                className={`timeline-group${g.destaque ? ' destaque' : ''}`}
                                              >
                                                <h3 className="timeline-title">{g.titulo}</h3>
                                                <ul className="timeline-list">
                                                  {g.itens.map((t) => (
                                                    <TaskRow
                                                      key={t._id}
                                                      task={t}
                                                      onToggle={() => toggle(t._id)}
                                                      onEdit={() => abrirEditar(t)}
                                                      onRemove={() => remove(t._id)}
                                                    />
                                                  ))}
                                                </ul>
                                              </section>
                                            ))}

                                            {concluidos.length > 0 && (
                                              <details className="timeline-done">
                                                <summary>Concluídos ({concluidos.length})</summary>
                                                <ul className="timeline-list">
                                                  {concluidos.map((t) => (
                                                    <TaskRow
                                                      key={t._id}
                                                      task={t}
                                                      onToggle={() => toggle(t._id)}
                                                      onEdit={() => abrirEditar(t)}
                                                      onRemove={() => remove(t._id)}
                                                    />
                                                  ))}
                                                </ul>
                                              </details>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </article>
                                  </section>
                                )}

                                {/* ==================== ABA 2: PLANO DO DIA ==================== */}
                                {tab === 'Plano do Dia' && (
                                  <section className="daily-plan-layout" role="tabpanel" aria-label="Plano do Dia">
                                    <article className="health-panel daily-plan-composer-card">
                                      <div className="health-section-heading">
                                        <div>
                                          <h2>Conselheiro do Dia</h2>
                                          <p>
                                            Cruza suas pendências com as próximas 4 semanas do Google Calendar e seus horários de treino.
                                          </p>
                                        </div>
                                        <button type="button" className="btn ghost" disabled={briefingLoading} onClick={ouvirBriefing}>
                                          {briefingLoading ? 'Preparando…' : 'Ouvir briefing'}
                                        </button>
                                      </div>

                                      <div className="chatgpt-prompt-box">
                                        <textarea
                                          value={dailyInput}
                                          onChange={(e) => setDailyInput(e.target.value)}
                                          placeholder="Ex.: Amanhã preciso ir à academia, pagar conta de luz, estudar para a prova e revisar o projeto..."
                                          rows={5}
                                          maxLength={6000}
                                          onKeyDown={(e) => {
                                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                              e.preventDefault();
                                              void analisarPlanoDoDia();
                                            }
                                          }}
                                        />
                                        <div className="chatgpt-prompt-bar">
                                          <span className="chatgpt-prompt-hint">
                                            Leitura de 4 semanas da agenda + rotina de saúde
                                          </span>
                                          <button
                                            type="button"
                                            className={`btn health-generate-button agenda-analyze-btn${dailyLoading ? ' is-loading' : ''}`}
                                            disabled={dailyLoading || !dailyInput.trim()}
                                            onClick={analisarPlanoDoDia}
                                          >
                                            {dailyLoading ? (
                                              <>
                                                <span className="health-spinner" /> Analisando…
                                              </>
                                            ) : (
                                              <>
                                                <SparkleIcon />
                                                <span>Analisar com IA</span>
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      </div>

                                      {dailyError && (
                                        <p className="health-message is-error" role="alert">
                                          {dailyError}
                                        </p>
                                      )}
                                    </article>

                                    <article className="health-panel daily-plan-result-card">
                                      <div className="health-section-heading">
                                        <div>
                                          <h2>Plano Priorizado</h2>
                                          <p>Recomendações realistas baseadas nas suas janelas livres.</p>
                                        </div>
                                        {dailyPlan && <button type="button" className="btn" disabled={dailySaving} onClick={() => void salvarPlanoDoDia()}>{dailySaving ? 'Salvando…' : 'Salvar Plano'}</button>}
                                      </div>

                                      <div className="daily-plan-scroll">
                                        {!dailyPlan && !dailyLoading && (
                                          <p className="health-empty">
                                            Digite suas tarefas acima e clique em Analisar com IA para receber uma estratégia priorizada.
                                          </p>
                                        )}

                                        {dailyLoading && (
                                          <div className="health-import-skeleton" aria-label="Gerando plano">
                                            <span />
                                            <span />
                                            <span />
                                          </div>
                                        )}

                                        {dailyPlan && (
                                          <div className="daily-plan-content">
                                            {Array.isArray(dailyPlan.itens) && dailyPlan.itens.length > 0 && (
                                              <div className="daily-plan-highlights">
                                                {dailyPlan.itens.map((item, idx) => {
                                                  const prioCfg =
                                                    PRIORIDADE_CONFIG[item.prioridade] || PRIORIDADE_CONFIG.urgente_hoje;
                                                  return (
                                                    <div
                                                      key={idx}
                                                      className="daily-plan-highlight-item"
                                                      style={
                                                        {
                                                          '--item-color': prioCfg.color,
                                                          '--item-bg': prioCfg.bg,
                                                          '--item-border': prioCfg.border,
                                                        } as CSSProperties
                                                      }
                                                    >
                                                      <span className="daily-plan-step-num">{item.ordem || idx + 1}</span>
                                                      <div className="daily-plan-step-body">
                                                        <div className="daily-plan-step-head">
                                                          <strong>{item.titulo}</strong>
                                                          <span className="daily-plan-step-tag">{item.destaque}</span>
                                                          {item.horarioSugerido && (
                                                            <span className="daily-plan-step-time">
                                                              <ClockIcon />
                                                              {item.horarioSugerido}
                                                            </span>
                                                          )}
                                                        </div>
                                                        {item.conselho && <p>{item.conselho}</p>}
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}

                                            <div className="daily-plan-raw-box">
                                              <h3>Resumo do Conselheiro</h3>
                                              <div className="daily-plan-lines">
                                                {(dailyPlan.plano || dailyPlan.texto || '')
                                                  .split(/\r?\n/)
                                                  .filter((line) => line.trim().length > 0)
                                                  .map((line, idx) => (
                                                    <p key={idx} className="daily-plan-line">
                                                      {line}
                                                    </p>
                                                  ))}
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                        {savedDailyPlan?.itens?.length ? <div className="daily-plan-saved-list">
                                          <h3>Plano salvo de hoje</h3>
                                          {savedDailyPlan.itens.map((item) => <div className={`daily-plan-saved-item${item.feito ? ' is-done' : ''}`} key={item._id}>
                                            <input type="checkbox" checked={item.feito} aria-label={`Concluir ${item.texto}`} onChange={() => void editarItemPlano(item, { feito: !item.feito })} />
                                            <input value={item.texto} aria-label="Editar item do plano" onChange={(event) => setSavedDailyPlan((current) => current && ({ ...current, itens: current.itens.map((entry) => entry._id === item._id ? { ...entry, texto: event.target.value } : entry) }))} onBlur={(event) => void editarItemPlano(item, { texto: event.target.value })} />
                                            <button className="icon-btn agenda-delete-btn" type="button" aria-label={`Excluir ${item.texto}`} onClick={() => void excluirItemPlano(item)}><TrashIcon /></button>
                                          </div>)}
                                        </div> : null}
                                      </div>
                                    </article>
                                  </section>
                                )}

                                {/* ==================== ABA 3: QUADRO DE METAS (KANBAN) ==================== */}
                                {tab === 'Quadro de Metas' && (
                                  <section className="kanban-panel-wrap" role="tabpanel" aria-label="Quadro de Metas">
                                    <header className="health-panel kanban-toolbar-card">
                                      <div className="kanban-toolbar-info">
                                        <h2>Quadro de Metas</h2>
                                        <p>
                                          Arraste os cards entre as colunas ou use as setas. Salvo automaticamente no seu perfil.
                                        </p>
                                      </div>
                                      <form className="kanban-add-form" onSubmit={adicionarMetaKanban}>
                                        <input
                                          type="text"
                                          aria-label="Nova meta"
                                          placeholder="Nova meta (ex: Terminar projeto)..."
                                          maxLength={200}
                                          value={newGoalTitle}
                                          onChange={(e) => setNewGoalTitle(e.target.value)}
                                        />
                                        <button type="submit" className="btn" disabled={!newGoalTitle.trim() || kanbanSaving}>
                                          <PlusIcon />
                                          <span>Criar Card</span>
                                        </button>
                                      </form>
                                    </header>

                                    <div className="kanban-board" data-no-shell-swipe>
                                      {KANBAN_COLUMNS.map((col, colIdx) => {
                                        const colCards = kanbanGoals.filter((g) => g.coluna === col.id);
                                        const prevCol = colIdx > 0 ? KANBAN_COLUMNS[colIdx - 1].id : null;
                                        const nextCol =
                                          colIdx < KANBAN_COLUMNS.length - 1 ? KANBAN_COLUMNS[colIdx + 1].id : null;

                                        return (
                                          <section
                                            key={col.id}
                                            className={`health-panel kanban-column${dragOverCol === col.id ? ' is-drag-over' : ''}`}
                                            style={{ '--col-accent': col.accent } as CSSProperties}
                                            aria-label={col.label}
                                            onDragOver={(e) => {
                                              e.preventDefault();
                                              if (dragOverCol !== col.id) setDragOverCol(col.id);
                                            }}
                                            onDragLeave={() => {
                                              if (dragOverCol === col.id) setDragOverCol(null);
                                            }}
                                            onDrop={(e) => handleDropColumn(e, col.id)}
                                          >
                                            <header className="kanban-column-head">
                                              <div className="kanban-column-title">
                                                <span className="kanban-column-dot" />
                                                <h3>{col.label}</h3>
                                              </div>
                                              <span className="kanban-column-count">{colCards.length}</span>
                                            </header>

                                            <div className="kanban-column-list">
                                              {kanbanLoading ? (
                                                <p className="health-empty">Carregando metas…</p>
                                              ) : colCards.length === 0 ? (
                                                <p className="kanban-empty-slot">Nenhum card</p>
                                              ) : (
                                                colCards.map((card) => (
                                                  <article
                                                    key={card.id}
                                                    className={`kanban-card${draggingGoalId === card.id ? ' is-dragging' : ''}`}
                                                    draggable
                                                    onDragStart={(e) => handleDragStart(e, card.id)}
                                                    onDragEnd={() => {
                                                      setDraggingGoalId(null);
                                                      setDragOverCol(null);
                                                    }}
                                                  >
                                                    <p className="kanban-card-title">{card.titulo}</p>
                                                    {card.prioridade && PRIORIDADE_CONFIG[card.prioridade] && <span className="kanban-priority-badge" style={{ color: PRIORIDADE_CONFIG[card.prioridade].color, background: PRIORIDADE_CONFIG[card.prioridade].bg, borderColor: PRIORIDADE_CONFIG[card.prioridade].border }}>{PRIORIDADE_CONFIG[card.prioridade].label}</span>}
                                                    <div className="kanban-card-actions">
                                                      {prevCol && (
                                                        <button
                                                          type="button"
                                                          className="kanban-move-btn"
                                                          aria-label={`Mover ${card.titulo} para ${KANBAN_COLUMNS[colIdx - 1].label}`}
                                                          title={`Mover para ${KANBAN_COLUMNS[colIdx - 1].label}`}
                                                          onClick={() => moverMetaKanban(card.id, prevCol)}
                                                        >
                                                          <ArrowLeftIcon />
                                                        </button>
                                                      )}
                                                      {nextCol && (
                                                        <button
                                                          type="button"
                                                          className="kanban-move-btn"
                                                          aria-label={`Mover ${card.titulo} para ${KANBAN_COLUMNS[colIdx + 1].label}`}
                                                          title={`Mover para ${KANBAN_COLUMNS[colIdx + 1].label}`}
                                                          onClick={() => moverMetaKanban(card.id, nextCol)}
                                                        >
                                                          <ArrowRightIcon />
                                                        </button>
                                                      )}
                                                      <button
                                                        type="button"
                                                        className="kanban-delete-btn"
                                                        aria-label={`Remover ${card.titulo}`}
                                                        title="Remover meta"
                                                        onClick={() => removerMetaKanban(card.id)}
                                                      >
                                                        <TrashIcon />
                                                      </button>
                                                    </div>
                                                  </article>
                                                ))
                                              )}
                                            </div>
                                          </section>
                                        );
                                      })}
                                    </div>
                                  </section>
                                )}
                              </div>

                              <TaskModal
                                open={modalOpen}
                                inicial={editando}
                                onSuggest={previewFromIA}
                                onClose={() => setModalOpen(false)}
                                onSave={salvar}
                                onDelete={editando ? () => remove(editando._id) : undefined}
                              />

                              <PreviewModal
                                open={previewAberto}
                                itens={previewItens}
                                onClose={() => setPreviewAberto(false)}
                                onConfirm={confirmarPreview}
                              />
                        </main>
                        );
}
