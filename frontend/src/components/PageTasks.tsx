import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PreviewItem, Task, Tipo, useTasks } from '../hooks/useTasks';

// ---------- constantes de UI ----------

const CORES_TIPO: Record<Tipo, string> = {
  evento: '#9db4ff',
  estudo: '#f0b95a',
  tarefa: '#86d7c0',
};
const LABEL_TIPO: Record<Tipo, string> = {
  evento: 'Evento',
  estudo: 'Estudo',
  tarefa: 'Tarefa',
};
const TIPOS: Tipo[] = ['tarefa', 'estudo', 'evento'];

// ---------- utilitários de data ----------

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());

/** ISO → data/hora local usada pelos campos separados. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** valor de datetime-local (hora local) → ISO UTC */
const fromLocalInput = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v); // navegador interpreta como hora local
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
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

const faixa = (t: Task) => {
  if (!t.inicio) return 'Sem horário';
  const ini = hhmm(t.inicio);
  return t.fim ? `${ini} – ${hhmm(t.fim)}` : ini;
};

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

  // ordenar itens internos por horário
  for (const arr of grupos.values()) {
    arr.sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
  }
  semData.sort((a, b) => a.titulo.localeCompare(b.titulo));

  const out: Grupo[] = [];

  // Atrasados: chaves < kHoje
  const chavesOrdenadas = Array.from(grupos.keys()).sort();
  const atrasados: Task[] = [];
  for (const k of chavesOrdenadas) {
    if (k < kHoje) atrasados.push(...grupos.get(k)!);
  }
  if (atrasados.length) {
    out.push({ key: 'atrasado', titulo: 'Atrasado', itens: atrasados });
  }

  // Hoje / Amanhã
  if (grupos.has(kHoje)) {
    out.push({ key: kHoje, titulo: 'Hoje', itens: grupos.get(kHoje)!, destaque: true });
  }
  if (grupos.has(kAmanha)) {
    out.push({ key: kAmanha, titulo: 'Amanhã', itens: grupos.get(kAmanha)! });
  }

  // Esta semana / Depois
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

  // Sem data
  if (semData.length) {
    out.push({ key: 'semdata', titulo: 'Sem data', itens: semData });
  }

  return { ativos: out, concluidos };
}

// ---------- modal de item (criar/editar) ----------

interface ModalProps {
  open: boolean;
  inicial?: Task | null;
  onClose: () => void;
  onSave: (payload: {
    titulo: string;
    descricao: string;
    tipo: Tipo;
    inicio: string | null;
    fim: string | null;
  }) => Promise<void>;
}

function TaskModal({ open, inicial, onClose, onSave }: ModalProps) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState<Tipo>('tarefa');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [sugestaoMsg, setSugestaoMsg] = useState('');

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setTitulo(inicial?.titulo ?? '');
    setDescricao(inicial?.descricao ?? '');
    setTipo(inicial?.tipo ?? 'tarefa');
    setInicio(toLocalInput(inicial?.inicio ?? null));
    setFim(toLocalInput(inicial?.fim ?? null));
    setSugestaoMsg('');
    setSalvando(false);
    setSugerindo(false);
  }, [open, inicial]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() || salvando) return;
    setSalvando(true);
    try {
      await onSave({
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        tipo,
        inicio: fromLocalInput(inicio),
        fim: fromLocalInput(fim),
      });
      onClose();
    } catch (err: any) {
      setSugestaoMsg('Falha ao salvar: ' + (err?.message || 'erro'));
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
            ✕
          </button>
        </header>

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
                placeholder="14:00"
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
                placeholder="15:00"
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

        {sugestaoMsg && <p className="ai-feedback err">{sugestaoMsg}</p>}

        <footer className="modal-foot">
          <button
            type="button"
            className="btn ghost"
            disabled={sugerindo || !descricao.trim()}
            onClick={async () => {
              setSugerindo(true);
              setSugestaoMsg('');
              try {
                const s = await import('../lib/api').then((m) =>
                  m.api<{ ok: boolean; sugestao: { titulo: string; tipo: Tipo; descricao: string } }>(
                    '/tasks/preview-roteiro',
                    {
                      method: 'POST',
                      body: JSON.stringify({ modo: 'sugestao', descricao }),
                    }
                  )
                );
                if (s.sugestao.titulo) setTitulo(s.sugestao.titulo);
                if (s.sugestao.tipo) setTipo(s.sugestao.tipo);
                setSugestaoMsg('Sugestão aplicada ✓');
              } catch (e: any) {
                setSugestaoMsg('IA falhou: ' + (e?.message || 'erro'));
              } finally {
                setSugerindo(false);
              }
            }}
          >
            {sugerindo ? 'Sugerindo…' : '✨ Salvar com IA'}
          </button>
          <div style={{ flex: 1 }} />
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

// ---------- preview de IA ----------

interface PreviewModalProps {
  open: boolean;
  itens: PreviewItem[];
  onClose: () => void;
  onConfirm: (itens: PreviewItem[]) => Promise<void>;
}

function PreviewDateTime({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const localValue = toLocalInput(value);
  const [dia, setDia] = useState(localValue.slice(0, 10));
  const [hora, setHora] = useState(localValue.slice(11, 16));

  useEffect(() => {
    setDia(localValue.slice(0, 10));
    setHora(localValue.slice(11, 16));
  }, [localValue]);

  const atualizar = (nextDia: string, nextHora: string) => {
    if (!nextDia) {
      onChange(null);
    } else if (horaValida24h(nextHora)) {
      const iso = fromLocalInput(`${nextDia}T${nextHora}`);
      if (iso) onChange(iso);
    }
  };

  return (
    <div className="preview-datetime">
      <DateInput
        ariaLabel="Data do item (dia/mês/ano)"
        value={dia}
        onChange={(nextDia) => {
          setDia(nextDia);
          const nextHora = horaValida24h(hora) ? hora : '09:00';
          setHora(nextHora);
          atualizar(nextDia, nextHora);
        }}
      />
      <input
        aria-label="Hora do item (24 horas)"
        type="text"
        inputMode="numeric"
        lang="pt-BR"
        placeholder="14:00"
        maxLength={5}
        pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
        value={hora}
        onChange={(e) => {
          setHora(e.target.value);
          atualizar(dia, e.target.value);
        }}
      />
    </div>
  );
}

function PreviewModal({ open, itens, onClose, onConfirm }: PreviewModalProps) {
  const [editaveis, setEditaveis] = useState<PreviewItem[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (open) {
      setEditaveis(itens.map((i) => ({ ...i })));
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
      setErro(error instanceof Error ? error.message : 'Falha ao inserir os itens.');
    } finally {
      setConfirmando(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Revisar itens gerados por IA</h3>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        {editaveis.length === 0 ? (
          <p className="muted">A IA não gerou itens. Ajuste o roteiro e tente novamente.</p>
        ) : (
          <ul className="preview-list">
            {editaveis.map((it, i) => (
              <li key={i} className="preview-item">
                <input
                  className="preview-titulo"
                  aria-label="Título do item"
                  value={it.titulo}
                  onChange={(e) => patch(i, { titulo: e.target.value })}
                  maxLength={200}
                  placeholder="Título do item"
                />
                <select
                  className="preview-tipo"
                  aria-label="Tipo do item"
                  value={it.tipo}
                  onChange={(e) => patch(i, { tipo: e.target.value as Tipo })}
                >
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {LABEL_TIPO[t]}
                    </option>
                  ))}
                </select>
                <div className="preview-dates">
                  <label className="preview-time-field">
                    <span>Início</span>
                    <PreviewDateTime
                      value={it.inicio}
                      onChange={(inicio) => patch(i, { inicio })}
                    />
                  </label>
                  <label className="preview-time-field">
                    <span>Fim</span>
                    <PreviewDateTime
                      value={it.fim}
                      onChange={(fim) => patch(i, { fim })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="icon-btn preview-remove"
                  aria-label="Remover item"
                  title="Remover item"
                  onClick={() => remover(i)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {erro && <p className="notice" role="alert">{erro}</p>}

        <footer className="modal-foot">
          <span className="muted" style={{ fontSize: '.85rem' }}>
            {editaveis.length} item(ns) para inserir
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn"
            onClick={confirmar}
            disabled={confirmando || editaveis.length === 0}
          >
            {confirmando ? 'Inserindo…' : 'Confirmar e inserir'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

// ---------- linha de item na timeline ----------

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
  return (
    <li className={`task-row${task.feito ? ' done' : ''}`}>
      <button
        className="check"
        onClick={onToggle}
        aria-label={task.feito ? 'Reabrir' : 'Concluir'}
      >
        {task.feito ? '✓' : ''}
      </button>
      <span
        className="type-bar"
        style={{ background: CORES_TIPO[task.tipo] }}
        aria-hidden
      />
      <div className="task-row-body" onClick={onEdit} role="button" tabIndex={0}>
        <div className="task-row-top">
          <span className="cal-item-time">{faixa(task)}</span>
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
      <button className="icon-btn" onClick={onRemove} aria-label="Excluir">
        ✕
      </button>
    </li>
  );
}

// ---------- página ----------

export default function PageTasks() {
  const {
    tasks,
    error,
    create,
    update,
    toggle,
    remove,
    previewFromIA,
  } = useTasks();

  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<Task | null>(null);

  // IA
  const [roteiro, setRoteiro] = useState('');
  const [gerando, setGerando] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [previewItens, setPreviewItens] = useState<PreviewItem[]>([]);
  const [iaMsg, setIaMsg] = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null);

  const { ativos, concluidos } = useMemo(() => agrupar(tasks), [tasks]);

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
    inicio: string | null;
    fim: string | null;
  }) => {
    if (editando) await update(editando._id, payload);
    else await create(payload);
  };

  const gerarPreview = async () => {
    if (!roteiro.trim() || gerando) return;
    setGerando(true);
    setIaMsg(null);
    try {
      const itens = await previewFromIA(roteiro);
      if (!itens.length) {
        setIaMsg({ tipo: 'err', msg: 'A IA não encontrou nada agendável nesse texto.' });
        return;
      }
      setPreviewItens(itens);
      setPreviewAberto(true);
    } catch (e: any) {
      setIaMsg({ tipo: 'err', msg: 'Falha ao gerar: ' + (e?.message || 'erro') });
    } finally {
      setGerando(false);
    }
  };

  const confirmarPreview = async (itens: PreviewItem[]) => {
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      try {
        await create({
          titulo: it.titulo,
          descricao: it.descricao,
          tipo: it.tipo,
          inicio: it.inicio,
          fim: it.fim,
        });
      } catch {
        const restantes = itens.slice(i);
        setPreviewItens(restantes);
        throw new Error(
          `Falha ao salvar. ${i} item(ns) foram inseridos; revise e tente novamente os restantes.`
        );
      }
    }
    setRoteiro('');
    setIaMsg({ tipo: 'ok', msg: `${itens.length} item(ns) inserido(s).` });
  };

  return (
    <div className="page tasks-page">
      <h2 className="page-title">Agenda</h2>

      {/* ---- IA de lote ---- */}
      <section className="ai-block">
        <h3 className="ai-block-title">✨ Gerar itens por IA</h3>
        <textarea
          value={roteiro}
          onChange={(e) => setRoteiro(e.target.value)}
          placeholder="Cole um roteiro: 'Seg e Qua às 20h estudar Cálculo. Sábado às 10h revisar tudo.'"
          rows={8}
          maxLength={4000}
          className="ai-textarea"
        />
        <div className="ai-block-actions">
          <button className="btn" onClick={gerarPreview} disabled={gerando || !roteiro.trim()}>
            {gerando ? 'Gerando…' : 'Mágica!'}
          </button>
          {iaMsg && <span className={`ai-feedback ${iaMsg.tipo}`}>{iaMsg.msg}</span>}
        </div>
      </section>

      {/* ---- botão novo ---- */}
      <div className="tasks-toolbar">
        <button className="btn" onClick={abrirNovo}>
          + Novo item
        </button>
      </div>

      {error && <p className="notice">{error}</p>}

      {/* ---- timeline ---- */}
      {ativos.length === 0 && concluidos.length === 0 && !error && (
        <p className="muted">Nada agendado. Crie um item acima ou use a IA.</p>
      )}

      {ativos.map((g) => (
        <section key={g.key} className={`timeline-group${g.destaque ? ' destaque' : ''}`}>
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

      <TaskModal
        open={modalOpen}
        inicial={editando}
        onClose={() => setModalOpen(false)}
        onSave={salvar}
      />

      <PreviewModal
        open={previewAberto}
        itens={previewItens}
        onClose={() => setPreviewAberto(false)}
        onConfirm={confirmarPreview}
      />
    </div>
  );
}
