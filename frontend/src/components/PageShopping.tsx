import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';

type ShoppingTab = 'carrinho' | 'dispensa' | 'receitas';
type ShoppingStatus = Exclude<ShoppingTab, 'receitas'>;
interface ShoppingItem {
  _id: string;
  item: string;
  emoji?: string;
  quantidade: string;
  status: 'dispensa' | 'carrinho';
  quantidadeEmCasa?: number;
  quantidadeNoCarrinho?: number;
  criadoEm: string;
}
interface ShoppingLists { dispensa: ShoppingItem[]; carrinho: ShoppingItem[] }
interface RecipeIngredient { item: string; quantidade: string }
interface RecipeResult {
  _id: string;
  prato: string;
  ingredientesDisponiveis: RecipeIngredient[];
  ingredientesFaltantes: RecipeIngredient[];
  instrucoes: string[];
  itensAdicionados: number;
}
interface PendingCartAdd {
  item: string;
  quantidade: string;
  emCasa: number;
}

const emptyLists: ShoppingLists = { dispensa: [], carrinho: [] };
const QUANTITY_OPTIONS = ['1', '2', 'Caixa'] as const;

function parseNumericQty(value: unknown, fallback = 1): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)/);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  }
  return fallback;
}

function normalizeItemKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function getEmCasa(item: ShoppingItem): number {
  if (typeof item.quantidadeEmCasa === 'number' && Number.isFinite(item.quantidadeEmCasa)) {
    return Math.max(0, Math.round(item.quantidadeEmCasa));
  }
  return item.status === 'dispensa' ? parseNumericQty(item.quantidade, 1) : 0;
}

function getNoCarrinho(item: ShoppingItem): number {
  if (typeof item.quantidadeNoCarrinho === 'number' && Number.isFinite(item.quantidadeNoCarrinho)) {
    return Math.max(0, Math.round(item.quantidadeNoCarrinho));
  }
  return item.status === 'carrinho' ? parseNumericQty(item.quantidade, 1) : 0;
}

function ItemIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 8 8-4 8 4-8 4-8-4Zm0 0v9l8 4 8-4V8M12 12v9" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>;
}

function AddIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

export default function PageShopping() {
  const { role } = useAuth();
  const [tab, setTab] = useState<ShoppingTab>('carrinho');
  const [lists, setLists] = useState<ShoppingLists>(emptyLists);
  const [newItems, setNewItems] = useState<Record<ShoppingStatus, string>>({ carrinho: '', dispensa: '' });
  const [quantities, setQuantities] = useState<Record<ShoppingStatus, string>>({ carrinho: '1', dispensa: '1' });
  const [openQtyMenu, setOpenQtyMenu] = useState<ShoppingStatus | null>(null);
  const [inlineQuantities, setInlineQuantities] = useState<Record<string, string>>({});
  const [dish, setDish] = useState('');
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState<ShoppingStatus | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState('');
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [pantryInlineQuantities, setPantryInlineQuantities] = useState<Record<string, string>>({});
  const [pendingCartAdd, setPendingCartAdd] = useState<PendingCartAdd | null>(null);
  const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);

  const load = useCallback(async () => {
    try { setLists(await api<ShoppingLists>('/shopping/list')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os itens.'); }
  }, []);

  useEffect(() => {
    void load();
    return subscribeRealtime((action) => { if (action === 'RELOAD_SHOPPING') void load(); });
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const submitAddItem = async (status: ShoppingStatus, text: string, quantidade: string) => {
    if (!text || savingStatus) return;
    setSavingStatus(status); setError('');
    try {
      await api<ShoppingItem>('/shopping/add', { method: 'POST', body: JSON.stringify({ item: text, status, quantidade }) });
      setNewItems((current) => ({ ...current, [status]: '' }));
      setQuantities((current) => ({ ...current, [status]: '1' }));
      await load();
      setToast('Item adicionado!');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível adicionar o item.'); }
    finally { setSavingStatus(null); }
  };

  const addItem = async (event: FormEvent, status: ShoppingStatus) => {
    event.preventDefault();
    const text = newItems[status].trim();
    const quantidade = (quantities[status] || '1').trim() || '1';
    if (!text || savingStatus) return;

    if (status === 'carrinho') {
      const normalizedInput = normalizeItemKey(text);
      const existingInPantry = lists.dispensa.find(
        (entry) => normalizeItemKey(entry.item) === normalizedInput && getEmCasa(entry) > 0
      );
      if (existingInPantry) {
        setPendingCartAdd({
          item: text,
          quantidade,
          emCasa: getEmCasa(existingInPantry),
        });
        return;
      }
    }

    await submitAddItem(status, text, quantidade);
  };

  const confirmPendingCartAdd = async () => {
    if (!pendingCartAdd) return;
    const { item, quantidade } = pendingCartAdd;
    setPendingCartAdd(null);
    await submitAddItem('carrinho', item, quantidade);
  };

  const adjustQuantity = async (item: ShoppingItem, delta: number, contexto: ShoppingStatus) => {
    if (adjustingId === item._id) return;
    setError('');
    const currentEmCasa = getEmCasa(item);
    const nextEmCasa = contexto === 'dispensa' ? Math.max(0, currentEmCasa + delta) : currentEmCasa;

    setLists((current) => ({
      ...current,
      dispensa: current.dispensa.map((entry) =>
        entry._id === item._id
          ? { ...entry, quantidadeEmCasa: nextEmCasa, quantidade: String(nextEmCasa) }
          : entry
      ),
      carrinho: current.carrinho.map((entry) =>
        entry._id === item._id
          ? { ...entry, quantidadeEmCasa: nextEmCasa }
          : entry
      ),
    }));

    setAdjustingId(item._id);
    try {
      await api<ShoppingItem>('/shopping/adjust', {
        method: 'PATCH',
        body: JSON.stringify({ itemId: item._id, delta, contexto }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível ajustar a quantidade.');
      await load();
    } finally {
      setAdjustingId(null);
    }
  };

  const deleteItem = async (item: ShoppingItem, contexto?: ShoppingStatus) => {
    setError('');
    const targetList = contexto ?? item.status;
    try {
      const query = contexto ? `?contexto=${contexto}` : '';
      await api<void>(`/shopping/${item._id}${query}`, { method: 'DELETE' });
      setLists((current) => ({ ...current, [targetList]: current[targetList].filter((entry) => entry._id !== item._id) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o item.'); }
  };

  const saveInlineQuantity = async (item: ShoppingItem) => {
    const rawDraft = inlineQuantities[item._id];
    if (rawDraft === undefined) return;
    const nextQty = rawDraft.trim() || '1';
    const currentQty = item.quantidade || '1';
    setInlineQuantities((prev) => {
      const copy = { ...prev };
      delete copy[item._id];
      return copy;
    });
    if (nextQty === currentQty) return;
    setError('');
    setLists((current) => ({
      ...current,
      [item.status]: current[item.status].map((entry) => entry._id === item._id ? { ...entry, quantidade: nextQty, quantidadeNoCarrinho: parseNumericQty(nextQty, 1) } : entry),
    }));
    try {
      await api<ShoppingItem>(`/shopping/${item._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantidade: nextQty }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a quantidade.');
      await load();
    }
  };

  const checkoutSummary = (() => {
    let emEstoque = 0;
    let comprado = 0;
    for (const item of lists.carrinho) {
      const itemComprado = Math.max(1, getNoCarrinho(item));
      const pantryMatch = lists.dispensa.find(
        (entry) => entry._id === item._id || normalizeItemKey(entry.item) === normalizeItemKey(item.item)
      );
      const itemEmEstoque = pantryMatch ? getEmCasa(pantryMatch) : getEmCasa(item);
      comprado += itemComprado;
      emEstoque += itemEmEstoque;
    }
    return { emEstoque, comprado, total: emEstoque + comprado };
  })();

  const checkout = async () => {
    if (!lists.carrinho.length || checkingOut) return;
    setConfirmCheckoutOpen(false);
    setCheckingOut(true); setError('');
    try {
      const result = await api<{ movidos: number }>('/shopping/checkout', { method: 'POST' });
      await load();
      setToast(`Sucesso! ${result.movidos} ${result.movidos === 1 ? 'item foi para a dispensa' : 'itens foram para a dispensa'}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a compra.'); }
    finally { setCheckingOut(false); }
  };

  const generateRecipe = async (event: FormEvent) => {
    event.preventDefault();
    if (!dish.trim() || generating) return;
    setGenerating(true); setError('');
    try {
      const result = await api<RecipeResult>('/shopping/recipe', { method: 'POST', body: JSON.stringify({ prato: dish.trim() }) });
      setRecipe(result);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível gerar a receita.'); }
    finally { setGenerating(false); }
  };

  const renderList = (items: ShoppingItem[], emptyMessage: string) => items.length ? (
    <ul className="task-list shopping-list">
      {items.map((item) => {
        const displayQty = inlineQuantities[item._id] !== undefined ? inlineQuantities[item._id] : (item.quantidade || '1');
        return (
          <li key={item._id} className="shopping-item">
            <span className="shopping-emoji" aria-hidden="true">{item.emoji || '📦'}</span>
            <span className="task-text">
              <span className="shopping-item-name">{item.item}</span>
              <input
                type="text"
                className="qty-inline-edit"
                aria-label={`Quantidade de ${item.item}`}
                value={displayQty}
                maxLength={80}
                onChange={(event) => setInlineQuantities((prev) => ({ ...prev, [item._id]: event.target.value }))}
                onBlur={() => void saveInlineQuantity(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            </span>
            <button className="icon-btn" type="button" onClick={() => void deleteItem(item, 'carrinho')} aria-label={`Excluir ${item.item}`} title="Excluir item"><TrashIcon /></button>
          </li>
        );
      })}
    </ul>
  ) : <div className="shopping-empty"><ItemIcon /><p>{emptyMessage}</p></div>;

  const savePantryInlineQuantity = async (item: ShoppingItem) => {
    const rawDraft = pantryInlineQuantities[item._id];
    if (rawDraft === undefined) return;
    const currentEmCasa = getEmCasa(item);
    const trimmed = rawDraft.trim();
    const parsed = trimmed === '' ? currentEmCasa : Number.parseInt(trimmed, 10);
    const nextEmCasa = Number.isFinite(parsed) ? Math.max(0, parsed) : currentEmCasa;

    setPantryInlineQuantities((prev) => {
      const copy = { ...prev };
      delete copy[item._id];
      return copy;
    });

    const delta = nextEmCasa - currentEmCasa;
    if (delta === 0) return;
    await adjustQuantity(item, delta, 'dispensa');
  };

  const renderPantryList = (items: ShoppingItem[], emptyMessage: string) => items.length ? (
    <ul className="task-list shopping-list">
      {items.map((item) => {
        const emCasa = getEmCasa(item);
        const displayEmCasa = pantryInlineQuantities[item._id] !== undefined
          ? pantryInlineQuantities[item._id]
          : String(emCasa);
        return (
          <li key={item._id} className={`shopping-item${emCasa === 0 ? ' is-empty-stock' : ''}`}>
            <span className="shopping-emoji" aria-hidden="true">{item.emoji || '📦'}</span>
            <span className="task-text pantry-task-text">
              <span className="shopping-item-name">{item.item}</span>
              <div className="pantry-qty-controller" role="group" aria-label={`Quantidade em casa de ${item.item}`}>
                <button
                  type="button"
                  className="pantry-qty-btn"
                  disabled={emCasa <= 0 || adjustingId === item._id}
                  onClick={() => void adjustQuantity(item, -1, 'dispensa')}
                  aria-label={`Diminuir quantidade de ${item.item}`}
                  title="Registrar consumo (-1)"
                >
                  -
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  className="pantry-qty-value"
                  aria-label={`Quantidade em casa de ${item.item}`}
                  value={displayEmCasa}
                  maxLength={6}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    const onlyDigits = event.target.value.replace(/[^\d]/g, '');
                    setPantryInlineQuantities((prev) => ({ ...prev, [item._id]: onlyDigits }));
                  }}
                  onBlur={() => void savePantryInlineQuantity(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button
                  type="button"
                  className="pantry-qty-btn"
                  disabled={adjustingId === item._id}
                  onClick={() => void adjustQuantity(item, 1, 'dispensa')}
                  aria-label={`Aumentar quantidade de ${item.item}`}
                  title="Adicionar ao estoque (+1)"
                >
                  +
                </button>
              </div>
            </span>
            <button className="icon-btn" type="button" onClick={() => void deleteItem(item, 'dispensa')} aria-label={`Excluir ${item.item}`} title="Excluir item"><TrashIcon /></button>
          </li>
        );
      })}
    </ul>
  ) : <div className="shopping-empty"><ItemIcon /><p>{emptyMessage}</p></div>;

  const renderAddForm = (status: ShoppingStatus) => {
    const destination = status === 'carrinho' ? 'carrinho' : 'dispensa';
    const saving = savingStatus === status;
    const menuOpen = openQtyMenu === status;
    return (
      <form className="shopping-add" onSubmit={(event) => void addItem(event, status)}>
        <input
          aria-label={`Novo item do ${destination}`}
          value={newItems[status]}
          onChange={(event) => setNewItems((current) => ({ ...current, [status]: event.target.value }))}
          placeholder="Adicionar item..."
          maxLength={200}
        />
        <div className="shopping-qty-combobox">
          <input
            type="text"
            autoComplete="off"
            className="shopping-qty-input"
            aria-label={`Quantidade para ${destination}`}
            placeholder="1"
            value={quantities[status]}
            maxLength={80}
            onFocus={(event) => {
              setOpenQtyMenu(status);
              event.currentTarget.select();
            }}
            onClick={() => setOpenQtyMenu(status)}
            onBlur={() => {
              window.setTimeout(() => {
                setOpenQtyMenu((current) => (current === status ? null : current));
                setQuantities((current) => ({ ...current, [status]: current[status].trim() || '1' }));
              }, 150);
            }}
            onChange={(event) => setQuantities((current) => ({ ...current, [status]: event.target.value }))}
          />
          {menuOpen && (
            <ul className="shopping-qty-dropdown" role="listbox" aria-label="Sugestões de quantidade">
              {QUANTITY_OPTIONS.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    className={quantities[status] === opt ? 'is-selected' : ''}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setQuantities((current) => ({ ...current, [status]: opt }));
                      setOpenQtyMenu(null);
                    }}
                  >
                    {opt}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn shopping-add-button" type="submit" disabled={!!savingStatus || !newItems[status].trim()}>
          <AddIcon />
          {saving ? 'Adicionando...' : 'Adicionar'}
        </button>
      </form>
    );
  };

  return (
    <main className={`shopping-page${role === 'guest' ? ' guest-shopping-page' : ''}`}>
      {toast && <div className="shopping-toast" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>{toast}</div>}
      <div className="shopping-heading"><div><span className="shopping-kicker">ERP doméstico</span><h2 className="page-title">Compras & Dispensa</h2></div></div>
      <nav className="shopping-tabs" aria-label="Seções de compras">
        {(['carrinho', 'dispensa', 'receitas'] as ShoppingTab[]).map((name) => (
          <button key={name} type="button" className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
            {name === 'carrinho' ? 'Carrinho' : name === 'dispensa' ? 'Dispensa' : 'Receitas'}
            {name !== 'receitas' && <span>{lists[name].length}</span>}
          </button>
        ))}
      </nav>

      {error && <p className="shopping-error" role="alert">{error}</p>}

      {tab === 'carrinho' && <section className="shopping-panel">
        <div className="shopping-section-title"><div><h3>Lista de compras</h3><p>Itens aqui ainda não contam como disponíveis.</p></div></div>
        {renderAddForm('carrinho')}
        {renderList(lists.carrinho, 'Seu carrinho está vazio.')}
        <button className="btn shopping-checkout" type="button" disabled={!lists.carrinho.length || checkingOut} onClick={() => setConfirmCheckoutOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          {checkingOut ? 'Confirmando compra...' : 'Confirmar Compra (Checkout)'}
        </button>
      </section>}

      {tab === 'dispensa' && <section className="shopping-panel">
        <div className="shopping-section-title"><div><h3>Na sua casa</h3><p>Somente estes itens serão considerados ao criar receitas.</p></div></div>
        {renderAddForm('dispensa')}
        {renderPantryList(lists.dispensa, 'Sua dispensa está vazia.')}
      </section>}

      {tab === 'receitas' && <section className="shopping-panel shopping-recipes">
        <div className="recipe-header">
          <div className="shopping-section-title"><div><h3>Cozinhe com o que você tem</h3><p>A IA confere sua dispensa e envia o que faltar ao carrinho.</p></div></div>
          <form className="shopping-recipe-search" onSubmit={generateRecipe}>
            <label htmlFor="recipe-dish">O que vamos comer hoje?</label>
            <div><input id="recipe-dish" value={dish} onChange={(event) => setDish(event.target.value)} placeholder="Ex.: Strogonoff de frango" maxLength={200} /><button className="btn" disabled={generating || !dish.trim()}>{generating ? 'Gerando...' : 'Gerar Receita com IA'}</button></div>
          </form>
        </div>
        {recipe && <article className="recipe-card">
          <header><span>Receita gerada</span><h3>{recipe.prato}</h3></header>
          <div className="recipe-columns">
            <section className="recipe-have"><h4>Você já tem</h4><ul>{recipe.ingredientesDisponiveis.map((ingredient, index) => <li key={`${ingredient.item}-${index}`}><span>{ingredient.item}</span><small>{ingredient.quantidade}</small></li>)}</ul></section>
            <section className="recipe-missing"><h4>Faltam</h4><ul>{recipe.ingredientesFaltantes.map((ingredient, index) => <li key={`${ingredient.item}-${index}`}><span>{ingredient.item}</span><small>{ingredient.quantidade}</small></li>)}</ul></section>
          </div>
          <section className="recipe-steps"><h4>Modo de preparo</h4><ol>{recipe.instrucoes.map((step, index) => <li key={index}>{step}</li>)}</ol></section>
          <footer><p>Adicionei <strong>{recipe.itensAdicionados} {recipe.itensAdicionados === 1 ? 'item' : 'itens'}</strong> ao seu Carrinho.</p><button className="btn ghost" type="button" onClick={() => setTab('carrinho')}>Ver Carrinho</button></footer>
        </article>}
      </section>}

      {pendingCartAdd && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shopping-stock-warn-title">
          <div className="shopping-modal">
            <h3 id="shopping-stock-warn-title">Item já em estoque</h3>
            <p>
              Atenção: Você tem {pendingCartAdd.emCasa} {pendingCartAdd.emCasa === 1 ? 'unidade' : 'unidades'} em casa. Deseja comprar mais?
            </p>
            <div className="shopping-modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setPendingCartAdd(null);
                  setTab('dispensa');
                }}
              >
                Ir para Dispensa
              </button>
              <button type="button" className="btn ghost" onClick={() => setPendingCartAdd(null)}>
                Cancelar
              </button>
              <button type="button" className="btn" onClick={() => void confirmPendingCartAdd()}>
                Comprar mais
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCheckoutOpen && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shopping-checkout-modal-title">
          <div className="shopping-modal">
            <h3 id="shopping-checkout-modal-title">Confirmar Compra</h3>
            <p>
              {checkoutSummary.total} {checkoutSummary.total === 1 ? 'item vai' : 'itens vão'} para a sua casa ({checkoutSummary.emEstoque} em estoque + {checkoutSummary.comprado} {checkoutSummary.comprado === 1 ? 'comprado' : 'comprados'}). Confirmar?
            </p>
            <div className="shopping-modal-actions">
              <button type="button" className="btn ghost" onClick={() => setConfirmCheckoutOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn" disabled={checkingOut} onClick={() => void checkout()}>
                {checkingOut ? 'Confirmando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
