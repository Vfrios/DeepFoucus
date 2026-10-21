import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getDefaultTaskColor } from '../lib/taskColors';

export type Tipo = 'tarefa' | 'evento' | 'estudo';

export interface Task {
  _id: string;
  titulo: string;
  descricao: string;
  tipo: Tipo;
  cor?: string;
  corPersonalizada?: boolean;
  inicio: string | null;
  fim: string | null;
  texto: string;
  data: string | null;
  feito: boolean;
  ordem: number;
  googleEventId?: string | null;
  calendarId?: string;
  calendarBackgroundColor?: string;
  externalCalendarEvent?: boolean;
  allDay?: boolean;
}

/** Payload aceito por `create` — todos os campos ricos, todos opcionais exceto titulo. */
export interface TaskPayload {
  titulo: string;
  descricao?: string;
  tipo?: Tipo;
  cor?: string;
  corPersonalizada?: boolean;
  inicio?: string | null;
  fim?: string | null;
  calendarId?: string;
}

/** Item retornado pelo preview da IA (ainda não persistido). */
export interface PreviewItem {
  titulo: string;
  descricao: string;
  tipo: Tipo;
  inicio: string | null;
  fim: string | null;
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const ref = useRef<Task[]>([]);
  const pending = useRef(0);
  ref.current = tasks;

  const load = useCallback(async () => {
    if (pending.current > 0) return;
    try {
      setTasks(await api<Task[]>('/tasks'));
      setError('');
    } catch {
      setError('Não foi possível carregar as tarefas.');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const optimistic = useCallback(
    async (apply: (t: Task[]) => Task[], request: () => Promise<void>) => {
      const snapshot = ref.current;
      setTasks(apply(snapshot));
      pending.current++;
      try {
        await request();
      } catch {
        setTasks(snapshot);
        setError('Falha ao salvar. Tente novamente.');
      } finally {
        pending.current--;
      }
    },
    []
  );

  // ---- cria com payload rico ----
  const create = useCallback(
    async (payload: TaskPayload): Promise<Task> => {
      const tmp: Task = {
        _id: `tmp-${Date.now()}`,
        titulo: payload.titulo,
        texto: payload.titulo,
        descricao: payload.descricao ?? '',
        tipo: payload.tipo ?? 'tarefa',
        cor: payload.cor ?? getDefaultTaskColor(payload.tipo ?? 'tarefa'),
        corPersonalizada: payload.corPersonalizada ?? false,
        inicio: payload.inicio ?? null,
        fim: payload.fim ?? null,
        data: payload.inicio ?? null,
        feito: false,
        ordem: ref.current.length,
        googleEventId: null,
        calendarId: payload.calendarId ?? 'primary',
      };
      setTasks((t) => [...t, tmp]);
      pending.current++;
      try {
        const created = await api<Task>('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            titulo: payload.titulo,
            descricao: payload.descricao,
            tipo: payload.tipo,
            cor: payload.cor,
            corPersonalizada: payload.corPersonalizada,
            inicio: payload.inicio,
            fim: payload.fim,
            calendarId: payload.calendarId,
          }),
        });
        setTasks((t) => t.map((x) => (x._id === tmp._id ? created : x)));
        return created;
      } catch (error) {
        setTasks((t) => t.filter((x) => x._id !== tmp._id));
        setError('Falha ao salvar. Tente novamente.');
        throw error;
      } finally {
        pending.current--;
      }
    },
    []
  );

  // ---- atalho legado: só título ----
  const add = useCallback(
    async (texto: string) => {
      await create({ titulo: texto });
    },
    [create]
  );

  // ---- update parcial ----
  const update = useCallback(
    async (id: string, patch: Partial<TaskPayload> & { feito?: boolean }) => {
      await optimistic(
        (t) =>
          t.map((x) =>
            x._id === id
              ? {
                  ...x,
                  ...(patch.titulo !== undefined ? { titulo: patch.titulo, texto: patch.titulo } : {}),
                  ...(patch.descricao !== undefined ? { descricao: patch.descricao } : {}),
                  ...(patch.tipo !== undefined ? { tipo: patch.tipo } : {}),
                  ...(patch.cor !== undefined ? { cor: patch.cor } : {}),
                  ...(patch.corPersonalizada !== undefined
                    ? { corPersonalizada: patch.corPersonalizada }
                    : {}),
                  ...(patch.inicio !== undefined
                    ? { inicio: patch.inicio, data: patch.inicio }
                    : {}),
                  ...(patch.fim !== undefined ? { fim: patch.fim } : {}),
                  ...(patch.feito !== undefined ? { feito: patch.feito } : {}),
                }
              : x
          ),
        async () => {
          await api(`/tasks/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });
        }
      );
    },
    [optimistic]
  );

  const toggle = useCallback(
    (id: string) => {
      const cur = ref.current.find((t) => t._id === id);
      if (!cur) return;
      return update(id, { feito: !cur.feito });
    },
    [update]
  );

  const remove = useCallback(
    (id: string) =>
      optimistic(
        (t) => t.filter((x) => x._id !== id),
        () => api(`/tasks/${id}`, { method: 'DELETE' })
      ),
    [optimistic]
  );

  const move = useCallback((fromId: string, toId: string) => {
    setTasks((t) => {
      const a = t.findIndex((x) => x._id === fromId);
      const b = t.findIndex((x) => x._id === toId);
      if (a < 0 || b < 0 || a === b) return t;
      const copy = [...t];
      const [item] = copy.splice(a, 1);
      copy.splice(b, 0, item);
      return copy;
    });
  }, []);

  const commitOrder = useCallback(async () => {
    const ids = ref.current.filter((t) => !t._id.startsWith('tmp-')).map((t) => t._id);
    pending.current++;
    try {
      await api('/tasks/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
    } catch {
      setError('Falha ao salvar a ordem.');
    } finally {
      pending.current--;
    }
  }, []);

  // ---- IA: geração direta (usada pela Página 1) ----
  const generateFromIA = useCallback(async (roteiro: string): Promise<{ inseridas: number }> => {
    const res = await api<{ ok: boolean; inseridas: number; tarefas: Task[] }>(
      '/tasks/from-roteiro',
      { method: 'POST', body: JSON.stringify({ roteiro }) }
    );
    if (res.tarefas?.length) {
      setTasks((prev) => [...prev, ...res.tarefas]);
    }
    return { inseridas: res.inseridas ?? 0 };
  }, []);

  // ---- IA: preview (Fase 3 — modal de revisão antes de gravar) ----
  const previewFromIA = useCallback(
    async (roteiro: string): Promise<PreviewItem[]> => {
      const res = await api<{ ok: boolean; tarefas: PreviewItem[] }>(
        '/tasks/from-roteiro',
        { method: 'POST', body: JSON.stringify({ roteiro, preview: true }) }
      );
      return res.tarefas ?? [];
    },
    []
  );

  // ---- IA: sugestão de título/tipo a partir da descrição ----
  const sugestaoIA = useCallback(
    async (
      descricao: string
    ): Promise<{ titulo: string; tipo: Tipo; descricao: string }> => {
      const res = await api<{
        ok: boolean;
        sugestao: { titulo: string; tipo: Tipo; descricao: string };
      }>('/tasks/preview-roteiro', {
        method: 'POST',
        body: JSON.stringify({ modo: 'sugestao', descricao }),
      });
      return res.sugestao;
    },
    []
  );

  const refetch = useCallback(() => load(), [load]);

  return {
    tasks,
    error,
    add,
    create,
    update,
    toggle,
    remove,
    move,
    commitOrder,
    generateFromIA,
    previewFromIA,
    sugestaoIA,
    refetch,
  };
}
