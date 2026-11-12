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
  const [clearing, setClearing] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editingText, setEditingText] = useState('');

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
  const saveItemName = async (item: ShoppingItem) => {
    if (!editingText.trim()) return;
    try {
      const updated = await api<ShoppingItem>(`/shopping/${item._id}`, { method: 'PATCH', body: JSON.stringify({ item: editingText.trim() }) });
      setItems((current) => current.map((entry) => entry._id === updated._id ? updated : entry));
      setEditingId('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível editar o item.'); }
  };

  const clearList = async () => {
    if (!items.length || clearing || !window.confirm('Limpar todos os itens da lista de compras?')) return;
    setClearing(true);
    setError('');
    try {
      await api('/shopping/clear', { method: 'DELETE' });
      setItems([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível limpar a lista.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <main className={`shopping-page${isGuest ? ' guest-shopping-page' : ''}`}>
      <div className="shopping-heading">
        <h2 className="page-title">Lista de Compras</h2>
        <button
          className="btn ghost shopping-clear-button"
          type="button"
          disabled={!items.length || clearing}
          onClick={() => void clearList()}
        >
          {clearing ? 'Limpando…' : 'Limpar lista'}
        </button>
      </div>
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
              <span className="shopping-emoji" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m4 8 8-4 8 4-8 4-8-4Zm0 0v9l8 4 8-4V8M12 12v9" /></svg></span>
              {editingId === item._id ? <input className="shopping-edit-input" autoFocus value={editingText} maxLength={200} aria-label={`Editar ${item.item}`} onChange={(event) => setEditingText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveItemName(item); if (event.key === 'Escape') setEditingId(''); }} /> : <span className="task-text">{item.item}</span>}
              <button className="icon-btn" type="button" aria-label={editingId === item._id ? `Salvar ${item.item}` : `Editar ${item.item}`} title={editingId === item._id ? 'Salvar' : 'Editar'} onClick={() => editingId === item._id ? void saveItemName(item) : (setEditingId(item._id), setEditingText(item.item))}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{editingId === item._id ? <path d="m5 12 4 4L19 6" /> : <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20ZM14 7l3 3" />}</svg></button>
              <button
                className="icon-btn"
                type="button"
                onClick={() => void deleteItem(item)}
                aria-label={`Excluir ${item.item}`}
                title="Excluir item"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
