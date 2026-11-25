import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';
import { checkoutConfirmationMode, reviewShoppingCheckout } from '../lib/shoppingCheckout';
import { parseReceiptCandidates } from '../lib/receiptOcr';

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
interface DevicePairing {
  code: string;
  expiresAt: string;
}
interface ReceiptDraft {
  nome: string;
  quantidade: string;
  selecionado: boolean;
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

function CameraIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
}

function PairIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10 17h4" /><path d="m9 9 2 2 4-4" /></svg>;
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
  const shoppingListFormRef = useRef<HTMLFormElement | null>(null);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const [devicePairing, setDevicePairing] = useState<DevicePairing | null>(null);
  const [startingPairing, setStartingPairing] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [receiptProgress, setReceiptProgress] = useState(0);
  const [receiptError, setReceiptError] = useState('');
  const [receiptItems, setReceiptItems] = useState<ReceiptDraft[]>([]);
  const [addingReceiptItems, setAddingReceiptItems] = useState(false);

  const load = useCallback(async () => {
    try { setLists(await api<ShoppingLists>('/shopping/list')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os itens.'); }
  }, []);

  const startDevicePairing = async () => {
    if (startingPairing) return;
    setStartingPairing(true);
    setError('');
    try {
      setDevicePairing(await api<DevicePairing>('/auth/device-pairing/start', { method: 'POST' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o código de pareamento.');
    } finally {
      setStartingPairing(false);
    }
  };

  const readReceipt = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Selecione uma imagem da nota fiscal.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('A imagem deve ter no máximo 12 MB.');
      return;
    }

    setError('');
    setReceiptError('');
    setReceiptItems([]);
    setReceiptProgress(0);
    setReceiptOpen(true);
    setReadingReceipt(true);
    const imageUrl = URL.createObjectURL(file);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('por', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') {
            setReceiptProgress(Math.round(message.progress * 100));
          }
        },
      });
      try {
        const { data } = await worker.recognize(imageUrl);
        const candidates = parseReceiptCandidates(data.text);
        setReceiptItems(candidates.map((nome) => ({ nome, quantidade: '1', selecionado: true })));
        if (!candidates.length) setReceiptError('Não encontrei itens na imagem. Tente uma foto mais nítida e bem iluminada.');
      } finally {
        try {
          await worker.terminate();
        } catch (cause) {
          console.warn('[shopping] receipt OCR worker cleanup failed:', cause);
        }
      }
    } catch (cause) {
      console.error('[shopping] receipt OCR failed:', cause);
      setReceiptError('Não foi possível ler a imagem. Verifique a conexão para carregar o OCR em português e tente novamente.');
    } finally {
      URL.revokeObjectURL(imageUrl);
      setReadingReceipt(false);
    }
  };

  const addReceiptItems = async () => {
    const selected = receiptItems
      .filter((item) => item.selecionado && item.nome.trim())
      .map((item) => ({ item: item.nome.trim(), quantidade: item.quantidade.trim() || '1' }));
    if (!selected.length || addingReceiptItems) return;

    setAddingReceiptItems(true);
    setReceiptError('');
    try {
      const result = await api<{ adicionados: number }>('/shopping/pantry/import', {
        method: 'POST',
        body: JSON.stringify({ itens: selected }),
      });
      await load();
      setTab('dispensa');
      setReceiptOpen(false);
      setToast(`${result.adicionados} ${result.adicionados === 1 ? 'item adicionado' : 'itens adicionados'} à dispensa.`);
    } catch (cause) {
      setReceiptError(cause instanceof Error ? cause.message : 'Não foi possível adicionar os itens à dispensa.');
    } finally {
      setAddingReceiptItems(false);
    }
  };

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

  const checkoutReview = reviewShoppingCheckout(
    newItems.carrinho.trim()
      ? [{ item: newItems.carrinho.trim(), quantidade: quantities.carrinho }]
      : [],
    lists.carrinho
  );
  const checkoutMode = checkoutConfirmationMode(checkoutReview.pendentes);

  const checkout = async () => {
    if (!checkoutReview.confirmados.length || checkingOut) return;
    setCheckingOut(true); setError('');
    try {
      const result = await api<{ movidos: number }>('/shopping/checkout', { method: 'POST' });
      await load();
      setConfirmCheckoutOpen(false);
      setToast(`Compra concluída: ${result.movidos} ${result.movidos === 1 ? 'item adicionado' : 'itens adicionados'} à dispensa.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a compra.'); }
    finally { setCheckingOut(false); }
  };

  const returnToShoppingList = () => {
    setConfirmCheckoutOpen(false);
    window.requestAnimationFrame(() => {
      shoppingListFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      shoppingListFormRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
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
      <form ref={status === 'carrinho' ? shoppingListFormRef : undefined} className="shopping-add" onSubmit={(event) => void addItem(event, status)}>
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
      <input
        ref={receiptInputRef}
        className="shopping-receipt-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void readReceipt(event)}
      />
      <div className="shopping-heading">
        <div><span className="shopping-kicker">ERP doméstico</span><h2 className="page-title">Compras & Dispensa</h2></div>
        {role === 'owner' && (
          <button className="btn ghost shopping-pair-button" type="button" disabled={startingPairing} onClick={() => void startDevicePairing()}>
            <PairIcon />
            {startingPairing ? 'Gerando...' : 'Conectar celular'}
          </button>
        )}
      </div>
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
        <button className="btn shopping-checkout" type="button" disabled={!checkoutReview.confirmados.length || checkingOut} onClick={() => setConfirmCheckoutOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          {checkingOut ? 'Confirmando compra...' : 'Concluir compra'}
        </button>
      </section>}

      {tab === 'dispensa' && <section className="shopping-panel">
        <div className="shopping-section-title shopping-pantry-title">
          <div><h3>Na sua casa</h3><p>Somente estes itens serão considerados ao criar receitas.</p></div>
          <button className="btn ghost shopping-receipt-button" type="button" onClick={() => receiptInputRef.current?.click()}>
            <CameraIcon />
            Escanear nota
          </button>
        </div>
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

      {devicePairing && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-pairing-title">
          <div className="shopping-modal shopping-pairing-modal">
            <h3 id="device-pairing-title">Conectar celular</h3>
            <p>Abra o Dashboard no celular usando o IP local do computador e digite este código na tela de login. Ele concede acesso de proprietário por até 30 dias.</p>
            <strong className="shopping-pairing-code" aria-label="Código de pareamento">
              {devicePairing.code.match(/.{1,4}/g)?.join('-')}
            </strong>
            <p>O código expira às {new Date(devicePairing.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} e só pode ser usado uma vez.</p>
            <div className="shopping-modal-actions">
              <button type="button" className="btn" onClick={() => setDevicePairing(null)}>Entendi</button>
            </div>
          </div>
        </div>
      )}

      {receiptOpen && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shopping-receipt-title">
          <div className="shopping-modal shopping-receipt-modal">
            <h3 id="shopping-receipt-title">Escanear nota fiscal</h3>
            <p>A leitura é feita neste dispositivo. Revise os nomes e quantidades antes de adicionar à dispensa.</p>
            {readingReceipt ? (
              <p className="shopping-receipt-progress" role="status">
                Lendo a nota em português... {receiptProgress}%
              </p>
            ) : receiptItems.length > 0 && (
              <>
                <p>Até {receiptItems.length} itens reconhecidos nesta leitura. Desmarque cabeçalhos e valores que não sejam produtos.</p>
                <ul className="shopping-receipt-items">
                  {receiptItems.map((item, index) => (
                    <li key={`${item.nome}-${index}`}>
                      <input
                        type="checkbox"
                        checked={item.selecionado}
                        aria-label={`Incluir ${item.nome}`}
                        onChange={(event) => setReceiptItems((current) => current.map((entry, itemIndex) =>
                          itemIndex === index ? { ...entry, selecionado: event.target.checked } : entry
                        ))}
                      />
                      <input
                        type="text"
                        value={item.nome}
                        maxLength={100}
                        aria-label={`Nome do produto ${index + 1}`}
                        onChange={(event) => setReceiptItems((current) => current.map((entry, itemIndex) =>
                          itemIndex === index ? { ...entry, nome: event.target.value } : entry
                        ))}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={item.quantidade}
                        maxLength={6}
                        aria-label={`Quantidade de ${item.nome}`}
                        onChange={(event) => setReceiptItems((current) => current.map((entry, itemIndex) =>
                          itemIndex === index
                            ? { ...entry, quantidade: event.target.value.replace(/[^\d]/g, '') }
                            : entry
                        ))}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {receiptError && <p className="shopping-error" role="alert">{receiptError}</p>}
            <div className="shopping-modal-actions">
              <button type="button" className="btn ghost" disabled={readingReceipt || addingReceiptItems} onClick={() => setReceiptOpen(false)}>
                {receiptItems.length ? 'Cancelar' : 'Fechar'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={readingReceipt || addingReceiptItems || !receiptItems.some((item) => item.selecionado && item.nome.trim())}
                onClick={() => void addReceiptItems()}
              >
                {addingReceiptItems ? 'Adicionando...' : 'Adicionar à dispensa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCheckoutOpen && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shopping-checkout-modal-title">
          <div className="shopping-modal">
            <h3 id="shopping-checkout-modal-title">Revisar compra</h3>
            <section className="shopping-checkout-review" aria-label="Itens confirmados no carrinho">
              <h4>Itens confirmados no carrinho</h4>
              <ul className="shopping-checkout-review-list">
                {checkoutReview.confirmados.map((item, index) => (
                  <li key={`${item.nome}-${index}`}><span>{item.nome}</span><strong>Qtd. {item.quantidade}</strong></li>
                ))}
              </ul>
            </section>
            {checkoutReview.pendentes.length > 0 && (
              <section className="shopping-checkout-pending" aria-label="Itens ainda na lista não confirmados">
                <h4>Itens ainda na lista (não confirmados)</h4>
                <ul className="shopping-checkout-review-list">
                  {checkoutReview.pendentes.map((item, index) => (
                    <li key={`${item.nome}-${index}`}><span>{item.nome}</span><strong>Qtd. {item.quantidade}</strong></li>
                  ))}
                </ul>
                <p>Esses itens não serão adicionados à dispensa nesta compra.</p>
              </section>
            )}
            <p>
              {checkoutSummary.total} {checkoutSummary.total === 1 ? 'item vai' : 'itens vão'} para a sua casa ({checkoutSummary.emEstoque} em estoque + {checkoutSummary.comprado} {checkoutSummary.comprado === 1 ? 'comprado' : 'comprados'}). Confirmar?
            </p>
            {error && <p className="shopping-error" role="alert">{error}</p>}
            <div className="shopping-modal-actions">
              {checkoutMode === 'warn' ? (
                <>
                  <button type="button" className="btn ghost" disabled={checkingOut} onClick={returnToShoppingList}>
                    Voltar à lista de compras
                  </button>
                  <button type="button" className="btn" disabled={checkingOut} onClick={() => void checkout()}>
                    {checkingOut ? 'Confirmando...' : 'Confirmar mesmo assim'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn ghost" disabled={checkingOut} onClick={() => setConfirmCheckoutOpen(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn" disabled={checkingOut} onClick={() => void checkout()}>
                    {checkingOut ? 'Confirmando...' : 'Confirmar'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
