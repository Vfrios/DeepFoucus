import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';
import { checkoutConfirmationMode, reviewShoppingCheckout } from '../lib/shoppingCheckout';
import { parseReceiptCandidates } from '../lib/receiptOcr';
import { prepareReceiptCanvas, receiptToJpegDataUrl, rotateCanvas } from '../lib/receiptImage';
import { snapToKnownProducts } from '../lib/receiptVocabulary';

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
interface ReceiptDraft {
  nome: string;
  quantidade: string;
  selecionado: boolean;
}
interface ShoppingToast {
  message: string;
  tone: 'success' | 'error';
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

function findShoppingItem(lists: ShoppingLists, key: string, id?: string): ShoppingItem | undefined {
  return [...lists.dispensa, ...lists.carrinho].find((item) =>
    (id !== undefined && item._id === id) || normalizeItemKey(item.item) === key
  );
}

function setShoppingItemViews(lists: ShoppingLists, key: string, item: ShoppingItem): ShoppingLists {
  const emCasa = getEmCasa(item);
  const noCarrinho = getNoCarrinho(item);
  const updateView = (entries: ShoppingItem[], status: ShoppingStatus, include: boolean) => {
    const index = entries.findIndex((entry) =>
      entry._id === item._id || normalizeItemKey(entry.item) === key
    );
    const next = entries.filter((entry) =>
      entry._id !== item._id && normalizeItemKey(entry.item) !== key
    );
    if (!include) return next;

    const view: ShoppingItem = {
      ...item,
      status,
      quantidade: status === 'dispensa'
        ? String(emCasa)
        : parseNumericQty(item.quantidade, 1) === noCarrinho
          ? item.quantidade
          : String(noCarrinho || 1),
    };
    next.splice(index < 0 ? 0 : Math.min(index, next.length), 0, view);
    return next;
  };

  return {
    dispensa: updateView(lists.dispensa, 'dispensa', emCasa > 0),
    carrinho: updateView(lists.carrinho, 'carrinho', noCarrinho > 0),
  };
}

function applyQuantityDelta(
  lists: ShoppingLists,
  key: string,
  delta: number,
  status: ShoppingStatus
): ShoppingLists {
  const item = findShoppingItem(lists, key);
  if (!item) return lists;

  const emCasa = status === 'dispensa'
    ? Math.max(0, getEmCasa(item) + delta)
    : getEmCasa(item);
  const noCarrinho = status === 'carrinho'
    ? Math.max(0, getNoCarrinho(item) + delta)
    : getNoCarrinho(item);

  return setShoppingItemViews(lists, key, {
    ...item,
    quantidade: status === 'dispensa' ? String(emCasa) : String(noCarrinho || emCasa || 1),
    quantidadeEmCasa: emCasa,
    quantidadeNoCarrinho: noCarrinho,
  });
}

function setCartQuantity(lists: ShoppingLists, key: string, quantity: string): ShoppingLists {
  const item = findShoppingItem(lists, key);
  if (!item) return lists;

  return setShoppingItemViews(lists, key, {
    ...item,
    quantidade: quantity,
    quantidadeNoCarrinho: parseNumericQty(quantity, 1),
  });
}

function reconcileShoppingItem(
  lists: ShoppingLists,
  key: string,
  saved: ShoppingItem,
  preservePendingChanges: boolean
): ShoppingLists {
  const current = findShoppingItem(lists, key, saved._id);
  if (preservePendingChanges && !current) return lists;

  return setShoppingItemViews(lists, key, {
    ...saved,
    item: preservePendingChanges && current ? current.item : saved.item,
    quantidade: preservePendingChanges && current ? current.quantidade : saved.quantidade,
    quantidadeEmCasa: preservePendingChanges && current ? getEmCasa(current) : getEmCasa(saved),
    quantidadeNoCarrinho: preservePendingChanges && current ? getNoCarrinho(current) : getNoCarrinho(saved),
  });
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

export default function PageShopping() {
  const { role } = useAuth();
  const [tab, setTab] = useState<ShoppingTab>('carrinho');
  const [lists, setLists] = useState<ShoppingLists>(emptyLists);
  const listsRef = useRef<ShoppingLists>(emptyLists);
  const [newItems, setNewItems] = useState<Record<ShoppingStatus, string>>({ carrinho: '', dispensa: '' });
  const [quantities, setQuantities] = useState<Record<ShoppingStatus, string>>({ carrinho: '1', dispensa: '1' });
  const [openQtyMenu, setOpenQtyMenu] = useState<ShoppingStatus | null>(null);
  const [inlineQuantities, setInlineQuantities] = useState<Record<string, string>>({});
  const [dish, setDish] = useState('');
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [error, setError] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [pendingLocalWrites, setPendingLocalWrites] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<ShoppingToast | null>(null);
  const [pantryInlineQuantities, setPantryInlineQuantities] = useState<Record<string, string>>({});
  const [pendingCartAdd, setPendingCartAdd] = useState<PendingCartAdd | null>(null);
  const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);
  const shoppingListFormRef = useRef<HTMLFormElement | null>(null);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [receiptProgress, setReceiptProgress] = useState(0);
  const [receiptStatusText, setReceiptStatusText] = useState('Iniciando...');
  const [receiptError, setReceiptError] = useState('');
  const [receiptItems, setReceiptItems] = useState<ReceiptDraft[]>([]);
  const [addingReceiptItems, setAddingReceiptItems] = useState(false);
  const mutationQueuesRef = useRef(new Map<string, Promise<void>>());
  const pendingMutationsRef = useRef(0);
  const pendingByKeyRef = useRef(new Map<string, number>());
  const reloadAfterMutationsRef = useRef(false);
  const tempToRealIdsRef = useRef(new Map<string, string>());
  const tempIdSequenceRef = useRef(0);

  const updateLists = useCallback((update: (current: ShoppingLists) => ShoppingLists) => {
    const next = update(listsRef.current);
    listsRef.current = next;
    setLists(next);
  }, []);

  const showToast = (message: string, tone: ShoppingToast['tone'] = 'success') => {
    setToast({ message, tone });
  };

  const load = useCallback(async () => {
    if (pendingMutationsRef.current > 0) {
      reloadAfterMutationsRef.current = true;
      return;
    }

    try {
      const loaded = await api<ShoppingLists>('/shopping/list');
      if (pendingMutationsRef.current > 0) {
        reloadAfterMutationsRef.current = true;
        return;
      }
      updateLists(() => loaded);
      setError('');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os itens.'); }
  }, [updateLists]);

  const queueMutation = (key: string, mutation: () => Promise<void>) => {
    pendingMutationsRef.current += 1;
    setPendingLocalWrites((current) => current + 1);
    pendingByKeyRef.current.set(key, (pendingByKeyRef.current.get(key) ?? 0) + 1);
    const previous = mutationQueuesRef.current.get(key) ?? Promise.resolve();
    const run = async () => {
      try {
        await mutation();
      } catch (cause) {
        console.error('[shopping] optimistic mutation failed:', cause);
        showToast('Não foi possível salvar a alteração. Tente novamente.', 'error');
      } finally {
        pendingMutationsRef.current -= 1;
        setPendingLocalWrites((current) => Math.max(0, current - 1));
        const pendingForKey = (pendingByKeyRef.current.get(key) ?? 1) - 1;
        if (pendingForKey > 0) pendingByKeyRef.current.set(key, pendingForKey);
        else pendingByKeyRef.current.delete(key);

        if (pendingMutationsRef.current === 0 && reloadAfterMutationsRef.current) {
          reloadAfterMutationsRef.current = false;
          void load();
        }
      }
    };
    const queued = previous.then(run, run);
    mutationQueuesRef.current.set(key, queued);
    void queued.then(() => {
      if (mutationQueuesRef.current.get(key) === queued) mutationQueuesRef.current.delete(key);
    });
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
    setReceiptStatusText('Iniciando...');
    setReceiptOpen(true);
    setReadingReceipt(true);
    const imageUrl = URL.createObjectURL(file);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let activeWorker: { terminate: () => Promise<unknown> } | null = null;
    let cancelled = false;
    let ocrDelayId: ReturnType<typeof setTimeout> | undefined;

    try {
      const known = [...lists.dispensa, ...lists.carrinho].map((entry) => entry.item);
      setReceiptStatusText('Lendo com IA e OCR...');

      // 1) IA de visão (backend): lê letra de mão bem melhor. A foto reduzida só vive em memória.
      const aiTask = (async (): Promise<Array<{ nome: string; quantidade: string }>> => {
        const controller = new AbortController();
        const abortId = setTimeout(() => controller.abort(), 28000);
        try {
          const image = await receiptToJpegDataUrl(imageUrl);
          const result = await api<{ itens: Array<{ nome: string; quantidade: string }> }>('/shopping/receipt-scan', {
            method: 'POST',
            body: JSON.stringify({ image }),
            signal: controller.signal,
          });
          return Array.isArray(result.itens) ? result.itens : [];
        } catch (cause) {
          console.warn('[shopping] leitura por IA indisponível, usando só o OCR:', cause);
          return [];
        } finally {
          clearTimeout(abortId);
        }
      })();

      // 2) OCR local (Tesseract) em paralelo: é a reserva se a IA falhar.
      const runOcr = (): Promise<string[]> => (async (): Promise<string[]> => {
        const base = await prepareReceiptCanvas(imageUrl);
        const { createWorker, PSM } = await import('tesseract.js');
        const worker = await createWorker('por', 1, {
          langPath: `${window.location.origin}/tessdata`,
          gzip: true,
          logger: (message) => {
            if (message.status === 'recognizing text' || message.status === 'loading language traineddata') {
              setReceiptProgress(Math.round(message.progress * 100));
            }
          },
        });
        activeWorker = worker;
        if (cancelled) {
          await worker.terminate();
          return [];
        }
        // Bloco único de texto: funciona melhor para listas curtas e manuscritas
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });

        // Lê na orientação original; se a confiança for baixa (foto deitada), testa 90° e 270°
        // e fica com a orientação mais confiável.
        const attempts: Array<0 | 90 | 270> = [0, 90, 270];
        let best: { found: string[]; confidence: number } | null = null;
        for (const degrees of attempts) {
          if (cancelled) break;
          const canvas = degrees === 0 ? base : rotateCanvas(base, degrees);
          const { data } = await worker.recognize(canvas);
          const found = parseReceiptCandidates(data.text);
          if (found.length && (!best || data.confidence > best.confidence)) {
            best = { found, confidence: data.confidence };
          }
          if (best && best.confidence >= 70) break;
        }
        return best?.found ?? [];
      })().catch((cause) => {
        console.warn('[shopping] OCR local falhou:', cause);
        return [] as string[];
      });

      // O OCR local só começa se a IA falhar ou demorar (poupa CPU e bateria do celular)
      let ocrPromise: Promise<string[]> | null = null;
      const startOcr = (): Promise<string[]> => {
        if (!ocrPromise) ocrPromise = runOcr();
        return ocrPromise;
      };
      ocrDelayId = setTimeout(() => { void startOcr(); }, 9000);

      const readAll = async (): Promise<Array<{ nome: string; quantidade: string }>> => {
        const aiItems = await aiTask;
        if (aiItems.length) return aiItems;
        setReceiptStatusText('Lendo com OCR local...');
        const found = snapToKnownProducts(await startOcr(), known);
        return found.map((nome) => ({ nome, quantidade: '1' }));
      };

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('TIMEOUT'));
        }, 45000);
      });

      const candidates = await Promise.race([readAll(), timeoutPromise]);
      setReceiptItems(candidates.map((item) => ({ ...item, selecionado: true })));
      if (!candidates.length) {
        setReceiptError('Nenhum item identificado. Tire uma foto mais nítida, mais próxima e bem iluminada.');
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'TIMEOUT') {
        console.warn('[shopping] receipt reading timed out');
        setReceiptError('Tempo esgotado ao ler a imagem. Tire uma foto mais nítida, mais próxima e bem iluminada.');
      } else {
        console.error('[shopping] receipt reading failed:', cause);
        setReceiptError('Não foi possível ler a imagem. Tire uma foto mais nítida e bem iluminada.');
      }
    } finally {
      cancelled = true;
      if (ocrDelayId) clearTimeout(ocrDelayId);
      if (timeoutId) clearTimeout(timeoutId);
      try {
        await (activeWorker as { terminate: () => Promise<unknown> } | null)?.terminate();
      } catch (cause) {
        console.warn('[shopping] receipt OCR worker cleanup failed:', cause);
      }
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
      showToast(`${result.adicionados} ${result.adicionados === 1 ? 'item adicionado' : 'itens adicionados'} à dispensa.`);
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
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const submitAddItem = (status: ShoppingStatus, text: string, quantidade: string) => {
    const itemName = text.trim();
    if (!itemName) return;

    const key = normalizeItemKey(itemName);
    const amount = parseNumericQty(quantidade, 1);
    const existing = findShoppingItem(listsRef.current, key);
    const tempId = existing?._id ?? `temp-${Date.now()}-${++tempIdSequenceRef.current}`;
    const baseItem: ShoppingItem = existing ?? {
      _id: tempId,
      item: itemName,
      quantidade,
      status,
      criadoEm: new Date().toISOString(),
    };
    const emCasa = getEmCasa(baseItem);
    const noCarrinho = getNoCarrinho(baseItem);
    const nextEmCasa = status === 'dispensa' ? emCasa + amount : emCasa;
    const nextNoCarrinho = status === 'carrinho' ? noCarrinho + amount : noCarrinho;
    const optimisticItem: ShoppingItem = {
      ...baseItem,
      status,
      quantidade: status === 'dispensa'
        ? String(nextEmCasa)
        : noCarrinho > 0 ? String(nextNoCarrinho) : quantidade,
      quantidadeEmCasa: nextEmCasa,
      quantidadeNoCarrinho: nextNoCarrinho,
    };

    setError('');
    updateLists((current) => setShoppingItemViews(current, key, optimisticItem));
    setNewItems((current) => ({ ...current, [status]: '' }));
    setQuantities((current) => ({ ...current, [status]: '1' }));

    queueMutation(key, async () => {
      try {
        const saved = await api<ShoppingItem>('/shopping/add', {
          method: 'POST',
          body: JSON.stringify({ item: itemName, status, quantidade }),
        });
        if (tempId.startsWith('temp-')) tempToRealIdsRef.current.set(tempId, saved._id);
        updateLists((current) =>
          reconcileShoppingItem(current, key, saved, (pendingByKeyRef.current.get(key) ?? 1) > 1)
        );
      } catch {
        updateLists((current) => applyQuantityDelta(current, key, -amount, status));
        showToast('Não foi possível adicionar o item. Tente novamente.', 'error');
      }
    });
  };

  const addItem = async (event: FormEvent, status: ShoppingStatus) => {
    event.preventDefault();
    const text = newItems[status].trim();
    const quantidade = (quantities[status] || '1').trim() || '1';
    if (!text) return;

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

  const adjustQuantity = (item: ShoppingItem, delta: number, contexto: ShoppingStatus) => {
    const key = normalizeItemKey(item.item);
    const before = findShoppingItem(listsRef.current, key, item._id) ?? item;
    setError('');
    updateLists((current) => applyQuantityDelta(current, key, delta, contexto));

    queueMutation(key, async () => {
      const itemId = item._id.startsWith('temp-') ? tempToRealIdsRef.current.get(item._id) : item._id;
      if (!itemId) {
        updateLists((current) => {
          if (findShoppingItem(current, key)) return applyQuantityDelta(current, key, -delta, contexto);
          return current;
        });
        return;
      }

      try {
        const saved = await api<ShoppingItem>('/shopping/adjust', {
          method: 'PATCH',
          body: JSON.stringify({ itemId, delta, contexto }),
        });
        updateLists((current) =>
          reconcileShoppingItem(current, key, saved, (pendingByKeyRef.current.get(key) ?? 1) > 1)
        );
      } catch {
        updateLists((current) => {
          if (findShoppingItem(current, key, itemId)) return applyQuantityDelta(current, key, -delta, contexto);
          return setShoppingItemViews(current, key, { ...before, _id: itemId });
        });
        showToast('Não foi possível ajustar a quantidade. Tente novamente.', 'error');
      }
    });
  };

  const deleteItem = (item: ShoppingItem, contexto?: ShoppingStatus) => {
    const targetList = contexto ?? item.status;
    const key = normalizeItemKey(item.item);
    const previousItems = listsRef.current[targetList];
    const previousIndex = previousItems.findIndex((entry) => entry._id === item._id);
    const previousItem = previousItems[previousIndex] ?? item;
    setError('');
    updateLists((current) => ({
      ...current,
      [targetList]: current[targetList].filter((entry) => entry._id !== item._id),
    }));

    queueMutation(key, async () => {
      const itemId = item._id.startsWith('temp-') ? tempToRealIdsRef.current.get(item._id) : item._id;
      if (!itemId) return;
      try {
        const query = contexto ? `?contexto=${contexto}` : '';
        await api<void>(`/shopping/${itemId}${query}`, { method: 'DELETE' });
        if (!listsRef.current.dispensa.some((entry) => normalizeItemKey(entry.item) === key)
          && !listsRef.current.carrinho.some((entry) => normalizeItemKey(entry.item) === key)) {
          tempToRealIdsRef.current.delete(item._id);
        }
      } catch {
        updateLists((current) => {
          const alreadyPresent = current[targetList].some((entry) =>
            entry._id === itemId || normalizeItemKey(entry.item) === key
          );
          if (alreadyPresent) return current;

          const otherList = targetList === 'dispensa' ? 'carrinho' : 'dispensa';
          const otherItem = current[otherList].find((entry) =>
            entry._id === itemId || normalizeItemKey(entry.item) === key
          );
          const restored: ShoppingItem = {
            ...previousItem,
            _id: itemId,
            ...(otherItem ? {
              quantidadeEmCasa: getEmCasa(otherItem),
              quantidadeNoCarrinho: getNoCarrinho(otherItem),
            } : {}),
            status: targetList,
          };
          const next = [...current[targetList]];
          next.splice(Math.max(0, Math.min(previousIndex, next.length)), 0, restored);
          return { ...current, [targetList]: next };
        });
        showToast('Não foi possível excluir o item. Tente novamente.', 'error');
      }
    });
  };

  const saveInlineQuantity = (item: ShoppingItem) => {
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
    const key = normalizeItemKey(item.item);
    const before = findShoppingItem(listsRef.current, key, item._id) ?? item;
    setError('');
    updateLists((current) => setCartQuantity(current, key, nextQty));

    queueMutation(key, async () => {
      const itemId = item._id.startsWith('temp-') ? tempToRealIdsRef.current.get(item._id) : item._id;
      if (!itemId) {
        updateLists((current) =>
          findShoppingItem(current, key) ? setCartQuantity(current, key, currentQty) : current
        );
        return;
      }

      try {
        const saved = await api<ShoppingItem>(`/shopping/${itemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantidade: nextQty }),
        });
        updateLists((current) =>
          reconcileShoppingItem(current, key, saved, (pendingByKeyRef.current.get(key) ?? 1) > 1)
        );
      } catch {
        updateLists((current) => {
          const cartItem = current.carrinho.find((entry) =>
            entry._id === itemId || normalizeItemKey(entry.item) === key
          );
          if (cartItem && cartItem.quantidade === nextQty) return setCartQuantity(current, key, currentQty);
          if (!cartItem) return setShoppingItemViews(current, key, { ...before, _id: itemId });
          return current;
        });
        showToast('Não foi possível atualizar a quantidade. Tente novamente.', 'error');
      }
    });
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
  const hasPendingShoppingWrites = pendingLocalWrites > 0;

  const checkout = async () => {
    if (!checkoutReview.confirmados.length || checkingOut || hasPendingShoppingWrites) return;
    setCheckingOut(true); setError('');
    try {
      const result = await api<{ movidos: number }>('/shopping/checkout', { method: 'POST' });
      await load();
      setConfirmCheckoutOpen(false);
      showToast(`Compra concluída: ${result.movidos} ${result.movidos === 1 ? 'item adicionado' : 'itens adicionados'} à dispensa.`);
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
          <li key={item._id} className="shopping-item" data-shopping-item-id={item._id}>
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
          <li key={item._id} className={`shopping-item${emCasa === 0 ? ' is-empty-stock' : ''}`} data-shopping-item-id={item._id}>
            <span className="shopping-emoji" aria-hidden="true">{item.emoji || '📦'}</span>
            <span className="task-text pantry-task-text">
              <span className="shopping-item-name">{item.item}</span>
              <div className="pantry-qty-controller" role="group" aria-label={`Quantidade em casa de ${item.item}`}>
                <button
                  type="button"
                  className="pantry-qty-btn"
                  disabled={emCasa <= 0}
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
        <button className="btn shopping-add-button" type="submit" disabled={!newItems[status].trim()}>
          <AddIcon />
          Adicionar
        </button>
      </form>
    );
  };

  return (
    <main className={`shopping-page${role === 'guest' ? ' guest-shopping-page' : ''}`}>
      {toast && (
        <div className={`shopping-toast${toast.tone === 'error' ? ' is-error' : ''}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.tone === 'success' && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
          {toast.message}
        </div>
      )}
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
        <button className="btn shopping-checkout" type="button" disabled={!checkoutReview.confirmados.length || checkingOut || hasPendingShoppingWrites} onClick={() => setConfirmCheckoutOpen(true)}>
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

      {receiptOpen && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shopping-receipt-title">
          <div className="shopping-modal shopping-receipt-modal">
            <h3 id="shopping-receipt-title">Escanear nota fiscal</h3>
            <p>A foto é lida por IA, com o OCR do aparelho como reserva, e não é salva. Revise os nomes e quantidades antes de adicionar à dispensa.</p>
            {readingReceipt ? (
              <p className="shopping-receipt-progress" role="status">
                {receiptStatusText} {receiptProgress}%
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
