import { useState, PointerEvent } from 'react';
import { useTasks } from '../hooks/useTasks';
import { api } from '../lib/api';

export default function PageTasks() {
  const { tasks, error, add, toggle, remove, move, commitOrder } = useTasks();
  const [text, setText] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  // ---- IA ----
  const [roteiro, setRoteiro] = useState('');
  const [gerando, setGerando] = useState(false);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    add(t);
  };

  const gerarPorIA = async () => {
    if (!roteiro.trim() || gerando) return;
    setGerando(true);
    try {
      await api('/tasks/from-roteiro', {
        method: 'POST',
        body: JSON.stringify({ roteiro }),
      });
      setRoteiro('');
      // Recarrega a lista (refetch via reload garante estado consistente com o servidor)
      window.location.reload();
    } catch (e: any) {
      alert('Falha ao gerar tarefas por IA: ' + (e?.message || 'erro desconhecido'));
    } finally {
      setGerando(false);
    }
  };

  // Reordenar com Pointer Events (funciona com toque e mouse)
  const down = (e: PointerEvent, id: string) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(id);
  };
  const moveEv = (e: PointerEvent) => {
    if (!dragId) return;
    const row = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-task-id]') as HTMLElement | null;
    const over = row?.dataset.taskId;
    if (over && over !== dragId) move(dragId, over);
  };
  const up = () => {
    if (dragId) commitOrder();
    setDragId(null);
  };

  return (
    <div className="page tasks">
      <h2 className="page-title">Tarefas</h2>

      {/* ---- Bloco IA ---- */}
      <section
        className="ai-block"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 14,
          marginBottom: 18,
          display: 'grid',
          gap: 10,
        }}
      >
        <h3 style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>✨ Gerar Tarefas por IA</h3>
        <textarea
          value={roteiro}
          onChange={(e) => setRoteiro(e.target.value)}
          placeholder="Cole seu roteiro aqui... Ex: Seg e Qua às 20h estudar Cálculo. Sábado às 10h revisar tudo."
          rows={4}
          maxLength={4000}
          style={{
            background: 'var(--ink)',
            border: '1px solid var(--line)',
            color: 'var(--paper)',
            borderRadius: 10,
            padding: '10px 12px',
            font: 'inherit',
            fontSize: 16,
            resize: 'vertical',
            width: '100%',
            userSelect: 'text',
            WebkitUserSelect: 'text',
          }}
        />
        <div>
          <button
            className="btn"
            onClick={gerarPorIA}
            disabled={gerando || !roteiro.trim()}
          >
            {gerando ? 'Gerando...' : 'Mágica!'}
          </button>
        </div>
      </section>

      {/* ---- CRUD manual (inalterado) ---- */}
      <div className="add">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Nova tarefa…"
          maxLength={200}
        />
        <button className="btn" onClick={submit}>
          Adicionar
        </button>
      </div>
      {error && <p className="notice">{error}</p>}
      {tasks.length === 0 && !error && (
        <p className="muted">Nenhuma tarefa. Adicione a primeira acima.</p>
      )}
      <ul className="task-list">
        {tasks.map((t) => (
          <li
            key={t._id}
            data-task-id={t._id}
            className={`${t.feito ? 'done' : ''}${dragId === t._id ? ' dragging' : ''}`}
          >
            <button
              className="check"
              onClick={() => toggle(t._id)}
              aria-label={t.feito ? 'Reabrir' : 'Concluir'}
            >
              {t.feito ? '✓' : ''}
            </button>
            <span className="task-text">{t.texto}</span>
            <button className="icon-btn" onClick={() => remove(t._id)} aria-label="Excluir">
              ✕
            </button>
            <span
              className="handle"
              data-nodrag
              onPointerDown={(e) => down(e, t._id)}
              onPointerMove={moveEv}
              onPointerUp={up}
              onPointerCancel={up}
              aria-label="Arrastar para reordenar"
            >
              ⠿
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
