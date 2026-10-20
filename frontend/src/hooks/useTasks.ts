import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export interface Task {
  _id: string;
  texto: string;
  feito: boolean;
  ordem: number;
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const ref = useRef<Task[]>([]);
  const pending = useRef(0); // evita que o polling sobrescreva mudanças otimistas em andamento
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

  /** Executa mutação otimista; em caso de erro volta ao estado anterior. */
  const optimistic = useCallback(async (apply: (t: Task[]) => Task[], request: () => Promise<void>) => {
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
  }, []);

  const add = useCallback(
    async (texto: string) => {
      const tmp: Task = { _id: `tmp-${Date.now()}`, texto, feito: false, ordem: ref.current.length };
      await optimistic(
        (t) => [...t, tmp],
        async () => {
          const created = await api<Task>('/tasks', { method: 'POST', body: JSON.stringify({ texto }) });
          setTasks((t) => t.map((x) => (x._id === tmp._id ? created : x)));
        }
      );
    },
    [optimistic]
  );

  const toggle = useCallback(
    (id: string) => {
      const cur = ref.current.find((t) => t._id === id);
      if (!cur) return;
      return optimistic(
        (t) => t.map((x) => (x._id === id ? { ...x, feito: !x.feito } : x)),
        () => api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ feito: !cur.feito }) })
      );
    },
    [optimistic]
  );

  const remove = useCallback(
    (id: string) =>
      optimistic(
        (t) => t.filter((x) => x._id !== id),
        () => api(`/tasks/${id}`, { method: 'DELETE' })
      ),
    [optimistic]
  );

  /** Durante o arrasto: só reordena localmente. */
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

  /** Ao soltar: persiste a ordem atual. */
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

  return { tasks, error, add, toggle, remove, move, commitOrder };
}
