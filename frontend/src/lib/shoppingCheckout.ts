export interface CheckoutCandidate {
  item: string;
  quantidade?: string;
  quantidadeNoCarrinho?: number;
}

export interface CheckoutReviewItem {
  nome: string;
  quantidade: number;
}

export interface CheckoutReview {
  confirmados: CheckoutReviewItem[];
  pendentes: CheckoutReviewItem[];
}

export type CheckoutConfirmationMode = 'confirm' | 'warn';

function itemKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

function quantity(value: string | undefined, fallback = 1): number {
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(/^(\d+)/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function cartQuantity(item: CheckoutCandidate): number {
  return typeof item.quantidadeNoCarrinho === 'number' && Number.isFinite(item.quantidadeNoCarrinho)
    ? Math.max(0, Math.round(item.quantidadeNoCarrinho))
    : quantity(item.quantidade);
}

export function reviewShoppingCheckout(
  listaCompras: readonly CheckoutCandidate[],
  carrinho: readonly CheckoutCandidate[]
): CheckoutReview {
  const confirmados = carrinho
    .map((item) => ({ nome: item.item, quantidade: cartQuantity(item) }))
    .filter((item) => item.nome.trim() && item.quantidade > 0);
  const carrinhoConfirmado = new Set(confirmados.map((item) => itemKey(item.nome)));
  const pendentes = listaCompras
    .map((item) => ({ nome: item.item, quantidade: quantity(item.quantidade) }))
    .filter((item) =>
      item.nome.trim() &&
      item.quantidade > 0 &&
      !carrinhoConfirmado.has(itemKey(item.nome))
    );

  return { confirmados, pendentes };
}

export function checkoutConfirmationMode(pendentes: readonly CheckoutReviewItem[]): CheckoutConfirmationMode {
  return pendentes.length ? 'warn' : 'confirm';
}
