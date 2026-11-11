import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';
import { useAuth } from '../AuthContext';

interface ShoppingItem {
  _id: string;
  item: string;
  emoji?: string;
  comprado: boolean;
  criadoEm: string;
}

export default function PageShopping() {
  const { role } = useAuth();
  const isGuest = role === 'guest';
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api<ShoppingItem[]>('/shopping/list'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar a lista.');
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeRealtime((action) => {
      if (action === 'RELOAD_SHOPPING') void load();
    });
  }, [load]);

  const addItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const item = await api<ShoppingItem>('/shopping/add', {
        method: 'POST',
        body: JSON.stringify({ item: input.trim() }),
      });
      setItems((current) => [item, ...current]);
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível adicionar o item.');
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = async (item: ShoppingItem) => {
    setError('');
    try {
      const updated = await api<ShoppingItem>(`/shopping/${item._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ comprado: !item.comprado }),
      });
      setItems((current) => current.map((entry) => entry._id === updated._id ? updated : entry));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível atualizar o item.');
    }
  };

  const deleteItem = async (item: ShoppingItem) => {
    setError('');
    try {
      await api<void>(`/shopping/${item._id}`, { method: 'DELETE' });
      setItems((current) => current.filter((entry) => entry._id !== item._id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir o item.');
    }
  };

  return (
    <main className={`shopping-page${isGuest ? ' guest-shopping-page' : ''}`}>
      <h2 className="page-title">Lista de Compras</h2>
      <form className="add shopping-add" onSubmit={addItem}>
        <input
          aria-label="Novo item"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Adicionar item..."
          maxLength={200}
        />
        <button className={`btn${isGuest ? ' guest-add-button' : ''}`} type="submit" disabled={saving || !input.trim()}>
          {saving ? 'Adicionando…' : isGuest ? 'Adicionar Item' : 'Adicionar'}
        </button>
      </form>

      {error && <p className="shopping-error" role="alert">{error}</p>}
      {items.length === 0 && !error ? (
        <p className="muted">Sua lista está vazia.</p>
      ) : (
        <ul className="task-list shopping-list">
          {items.map((item) => (
            <li key={item._id} className={item.comprado ? 'done' : ''}>
              <input
                className="shopping-check"
                type="checkbox"
                checked={item.comprado}
                onChange={() => void toggleItem(item)}
                aria-label={`Marcar ${item.item} como ${item.comprado ? 'não comprado' : 'comprado'}`}
              />
              <span className="shopping-emoji" aria-hidden="true">{item.emoji || '📦'}</span>
              <span className="task-text">{item.item}</span>
              <button
                className="icon-btn"
                type="button"
                onClick={() => void deleteItem(item)}
                aria-label={`Excluir ${item.item}`}
                title="Excluir item"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
