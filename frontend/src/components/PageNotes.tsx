import { FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';

type Tipo = 'tarefa' | 'evento' | 'estudo';

interface Nota {
  _id: string;
  titulo: string;
  conteudo: string;
  cor: string;
  criadoEm: string;
  atualizadoEm: string;
}

interface TarefaSugerida {
  titulo: string;
  descricao: string;
  tipo: Tipo;
  inicio: string;
  fim: string | null;
}

const CORES = ['#86d7c0', '#f0b95a', '#e67c73', '#9db4ff', '#c8a2f0', '#a8e6a3'];

const LABEL_TIPO: Record<Tipo, string> = {
  tarefa: 'Tarefa',
  evento: 'Evento',
  estudo: 'Estudo',
};

// ---------- modal de nota ----------

function NoteModal({
  open,
  inicial,
  onClose,
  onSave,
}: {
  open: boolean;
  inicial?: Nota | null;
  onClose: () => void;
  onSave: (n: { titulo: string; conteudo: string; cor: string }) => Promise<void>;
}) {
  const [titulo, setTitulo] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [cor, setCor] = useState(CORES[0]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitulo(inicial?.titulo ?? '');
    setConteudo(inicial?.conteudo ?? '');
    setCor(inicial?.cor ?? CORES[0]);
    setSalvando(false);
    setErro('');
  }, [open, inicial]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    if (!titulo.trim() && !conteudo.trim()) {
      setErro('Preencha título ou conteúdo.');
      return;
    }
    setSalvando(true);
    try {
      await onSave({ titulo: titulo.trim(), conteudo: conteudo.trim(), cor });
      onClose();
    } catch (err: any) {
      setErro('Falha: ' + (err?.message || 'erro'));
    } finally {
      setSalvando(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-head">
          <h3>{inicial ? 'Editar nota' : 'Nova nota'}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <label className="field">
          <span>Título</span>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={120}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Conteúdo</span>
          <textarea
            value={conteudo}
            onChange={(e) => setConteudo(e.target.value)}
            rows={5}
            maxLength={5000}
          />
        </label>

        <div className="field">
          <span>Cor</span>
          <div className="color-row">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-dot${c === cor ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setCor(c)}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
        </div>

        {erro && <p className="ai-feedback err">{erro}</p>}

        <footer className="modal-foot">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}

// ---------- modal de resumo ----------

function SummaryModal({
  open,
  resumo,
  tarefas,
  onClose,
  onAddTarefa,
}: {
  open: boolean;
  resumo: string;
  tarefas: TarefaSugerida[];
  onClose: () => void;
  onAddTarefa: (t: TarefaSugerida) => Promise<void>;
}) {
  const [copiado, setCopiado] = useState(false);
  const [adicionando, setAdicionando] = useState<number | null>(null);
  const [adicionados, setAdicionados] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setCopiado(false);
      setAdicionando(null);
      setAdicionados(new Set());
    }
  }, [open]);

  if (!open) return null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resumo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* clipboard negado — silencioso */
    }
  };

  const adicionar = async (idx: number) => {
    if (adicionando !== null || adicionados.has(idx)) return;
    setAdicionando(idx);
    try {
      await onAddTarefa(tarefas[idx]);
      setAdicionados((s) => new Set(s).add(idx));
    } finally {
      setAdicionando(null);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Organizar com IA</h3>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <section className="summary-block">
          <h4 className="summary-title">Resumo</h4>
          <p className="summary-text">{resumo || '(sem resumo)'}</p>
          {resumo && (
            <button className="btn ghost" onClick={copiar}>
              {copiado ? 'Copiado ✓' : 'Copiar resumo'}
            </button>
          )}
        </section>

        <section className="summary-block">
          <h4 className="summary-title">Tarefas sugeridas</h4>
          {tarefas.length === 0 ? (
            <p className="muted">A IA não encontrou ações concretas nas notas.</p>
          ) : (
            <ul className="summary-list">
              {tarefas.map((t, i) => (
                <li key={i} className="summary-item">
                  <div className="summary-item-body">
                    <strong>{t.titulo}</strong>
                    <span className="summary-meta">
                      {LABEL_TIPO[t.tipo]} ·{' '}
                      {new Date(t.inicio).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {t.descricao && <p className="summary-desc">{t.descricao}</p>}
                  </div>
                  <button
                    className="btn"
                    disabled={adicionando !== null || adicionados.has(i)}
                    onClick={() => adicionar(i)}
                  >
                    {adicionados.has(i)
                      ? 'Adicionada ✓'
                      : adicionando === i
                        ? 'Adicionando…'
                        : 'Adicionar à Agenda'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

// ---------- página ----------

export default function PageNotes() {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<Nota | null>(null);

  const [resumindo, setResumindo] = useState(false);
  const [resumoAberto, setResumoAberto] = useState(false);
  const [resumo, setResumo] = useState('');
  const [sugestoes, setSugestoes] = useState<TarefaSugerida[]>([]);
  const [iaMsg, setIaMsg] = useState('');

  const load = async () => {
    try {
      setNotas(await api<Nota[]>('/notes'));
      setErro('');
    } catch {
      setErro('Não foi possível carregar as notas.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const criar = async (payload: { titulo: string; conteudo: string; cor: string }) => {
    const created = await api<Nota>('/notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setNotas((n) => [created, ...n]);
  };

  const atualizar = async (id: string, payload: { titulo: string; conteudo: string; cor: string }) => {
    const updated = await api<Nota>(`/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    setNotas((n) => n.map((x) => (x._id === id ? updated : x)));
  };

  const excluir = async (id: string) => {
    setNotas((n) => n.filter((x) => x._id !== id));
    try {
      await api(`/notes/${id}`, { method: 'DELETE' });
    } catch {
      void load(); // refaz em caso de erro
    }
  };

  const organizar = async () => {
    if (resumindo) return;
    setResumindo(true);
    setIaMsg('');
    try {
      const r = await api<{ ok: boolean; resumo: string; tarefas: TarefaSugerida[] }>(
        '/notes/summarize',
        { method: 'POST' }
      );
      setResumo(r.resumo);
      setSugestoes(r.tarefas || []);
      setResumoAberto(true);
    } catch (e: any) {
      setIaMsg('Falha ao resumir: ' + (e?.message || 'erro'));
    } finally {
      setResumindo(false);
    }
  };

  const adicionarTarefa = async (t: TarefaSugerida) => {
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        titulo: t.titulo,
        descricao: t.descricao,
        tipo: t.tipo,
        inicio: t.inicio,
        fim: t.fim,
      }),
    });
  };

  return (
    <div className="page notes-page">
      <div className="notes-head">
        <h2 className="page-title">Notas & Quadro</h2>
        <div className="notes-actions">
          <button
            className="btn ghost"
            onClick={organizar}
            disabled={resumindo || notas.length === 0}
          >
            {resumindo ? 'Analisando…' : '🤖 Organizar com IA'}
          </button>
          <button
            className="btn"
            onClick={() => {
              setEditando(null);
              setModalOpen(true);
            }}
          >
            + Nova nota
          </button>
        </div>
      </div>

      {iaMsg && <p className="ai-feedback err">{iaMsg}</p>}
      {erro && <p className="notice">{erro}</p>}

      {carregando && <p className="muted">Carregando…</p>}

      {!carregando && notas.length === 0 && (
        <div className="cal-empty-card">
          <strong>Nenhuma nota ainda.</strong>
          <p>
            Use <em>+ Nova nota</em> para adicionar uma ideia, ou cole um bloco de texto solto.
            Depois, <em>Organizar com IA</em> resume tudo e sugere tarefas.
          </p>
        </div>
      )}

      <div className="notes-grid">
        {notas.map((n) => (
          <article key={n._id} className="note-card" style={{ borderTopColor: n.cor }}>
            <header className="note-card-head">
              <h3 className="note-title">{n.titulo}</h3>
              <div className="note-card-actions">
                <button
                  className="icon-btn"
                  onClick={() => {
                    setEditando(n);
                    setModalOpen(true);
                  }}
                  aria-label="Editar"
                >
                  ✎
                </button>
                <button
                  className="icon-btn"
                  onClick={() => excluir(n._id)}
                  aria-label="Excluir"
                >
                  ✕
                </button>
              </div>
            </header>
            {n.conteudo && <p className="note-body">{n.conteudo}</p>}
          </article>
        ))}
      </div>

      <NoteModal
        open={modalOpen}
        inicial={editando}
        onClose={() => setModalOpen(false)}
        onSave={async (payload) => {
          if (editando) await atualizar(editando._id, payload);
          else await criar(payload);
        }}
      />

      <SummaryModal
        open={resumoAberto}
        resumo={resumo}
        tarefas={sugestoes}
        onClose={() => setResumoAberto(false)}
        onAddTarefa={adicionarTarefa}
      />
    </div>
  );
}
