import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';

type ShoppingTab = 'carrinho' | 'dispensa' | 'receitas';
type ShoppingStatus = Exclude<ShoppingTab, 'receitas'>;
interface ShoppingItem { _id: string; item: string; emoji?: string; quantidade: string; status: 'dispensa' | 'carrinho'; criadoEm: string }
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

const emptyLists: ShoppingLists = { dispensa: [], carrinho: [] };

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
  const [dish, setDish] = useState('');
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState<ShoppingStatus | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState('');

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

  const addItem = async (event: FormEvent, status: ShoppingStatus) => {
    event.preventDefault();
    const text = newItems[status].trim();
    if (!text || savingStatus) return;
    setSavingStatus(status); setError('');
    try {
      await api<ShoppingItem>('/shopping/add', { method: 'POST', body: JSON.stringify({ item: text, status }) });
      setNewItems((current) => ({ ...current, [status]: '' }));
      await load();
      setToast('Item adicionado!');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível adicionar o item.'); }
    finally { setSavingStatus(null); }
  };

  const deleteItem = async (item: ShoppingItem) => {
    setError('');
    try {
      await api<void>(`/shopping/${item._id}`, { method: 'DELETE' });
      setLists((current) => ({ ...current, [item.status]: current[item.status].filter((entry) => entry._id !== item._id) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o item.'); }
  };

  const checkout = async () => {
    if (!lists.carrinho.length || checkingOut) return;
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
      {items.map((item) => <li key={item._id}>
        <span className="shopping-emoji" aria-hidden="true">{item.emoji || '📦'}</span>
        <span className="task-text">{item.item}<small>{item.quantidade}</small></span>
        <button className="icon-btn" type="button" onClick={() => void deleteItem(item)} aria-label={`Excluir ${item.item}`} title="Excluir item"><TrashIcon /></button>
      </li>)}
    </ul>
  ) : <div className="shopping-empty"><ItemIcon /><p>{emptyMessage}</p></div>;

  const renderAddForm = (status: ShoppingStatus) => {
    const destination = status === 'carrinho' ? 'carrinho' : 'dispensa';
    const saving = savingStatus === status;
    return (
      <form className="shopping-add" onSubmit={(event) => void addItem(event, status)}>
        <input
          aria-label={`Novo item do ${destination}`}
          value={newItems[status]}
          onChange={(event) => setNewItems((current) => ({ ...current, [status]: event.target.value }))}
          placeholder="Adicionar item..."
          maxLength={200}
        />
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
        <button className="btn shopping-checkout" type="button" disabled={!lists.carrinho.length || checkingOut} onClick={() => void checkout()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          {checkingOut ? 'Confirmando compra...' : 'Confirmar Compra (Checkout)'}
        </button>
      </section>}

      {tab === 'dispensa' && <section className="shopping-panel">
        <div className="shopping-section-title"><div><h3>Na sua casa</h3><p>Somente estes itens serão considerados ao criar receitas.</p></div></div>
        {renderAddForm('dispensa')}
        {renderList(lists.dispensa, 'Sua dispensa está vazia.')}
      </section>}

      {tab === 'receitas' && <section className="shopping-panel shopping-recipes">
        <div className="shopping-section-title"><div><h3>Cozinhe com o que você tem</h3><p>A IA confere sua dispensa e envia o que faltar ao carrinho.</p></div></div>
        <form className="shopping-recipe-search" onSubmit={generateRecipe}>
          <label htmlFor="recipe-dish">O que vamos comer hoje?</label>
          <div><input id="recipe-dish" value={dish} onChange={(event) => setDish(event.target.value)} placeholder="Ex.: Strogonoff de frango" maxLength={200} /><button className="btn" disabled={generating || !dish.trim()}>{generating ? 'Gerando...' : 'Gerar Receita com IA'}</button></div>
        </form>
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
    </main>
  );
}
