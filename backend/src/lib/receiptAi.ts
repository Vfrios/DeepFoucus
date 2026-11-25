import { callVisionAI } from './ai';

const MAX_ITEMS = 40;
export const MAX_RECEIPT_IMAGE_CHARS = 3_500_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export interface ReceiptAiItem {
  nome: string;
  quantidade: string;
}

const SYSTEM_PROMPT =
  'Você lê fotos de notas fiscais de mercado (NFC-e) e de listas de compras escritas à mão, em português do Brasil. ' +
  'A foto pode estar girada ou torta: leia mesmo assim. ' +
  'Extraia SOMENTE os produtos comprados e ignore cabeçalho, CNPJ, endereço, datas, totais, forma de pagamento, tributos, chave de acesso e QR code. ' +
  'Em notas fiscais cada linha de produto tem o formato "CÓDIGO DESCRIÇÃO QTD UNIDADE x PREÇO TOTAL". ' +
  'Escreva o nome de forma legível, expandindo abreviações óbvias (CERV=Cerveja, IOG=Iogurte, DET PO=Detergente em Pó, BEB LAC=Bebida Láctea, BOV=Bovino, FRANC=Francês) ' +
  'e mantendo marca e tamanho (ex.: "Cerveja Bruss Gold 473ml"), sem o código numérico. ' +
  'A quantidade é o número inteiro de unidades compradas (ex.: "8 LT x 4,18" => 8; "3 PT x 18,98" => 3). ' +
  'Para itens vendidos por peso (kg, ex.: "0,586 kg x 59,90") a quantidade é 1. Em listas manuscritas, use 1 se não houver número. ' +
  'Responda apenas com JSON no formato {"itens":[{"nome":"Leite","quantidade":1}]}; se não houver produtos, {"itens":[]}.';

export function isReceiptImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_RECEIPT_IMAGE_CHARS && IMAGE_DATA_URL.test(value);
}

function itemKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '');
}

function cleanQuantity(value: unknown): string {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : 1;
  return Number.isInteger(n) && n >= 1 && n <= 999 ? String(n) : '1';
}

/** Valida e limpa a resposta da IA: nomes curtos, quantidade inteira, sem duplicatas, no máximo 40. */
export function cleanReceiptItems(raw: unknown): ReceiptAiItem[] {
  const list = (raw as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const items: ReceiptAiItem[] = [];
  for (const entry of list) {
    const source = typeof entry === 'string'
      ? { nome: entry, quantidade: 1 }
      : entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const rawName = source && (typeof source.nome === 'string' ? source.nome : typeof source.item === 'string' ? source.item : '');
    if (!source || !rawName) continue;
    const nome = rawName.replace(/\s+/g, ' ').trim();
    const key = itemKey(nome);
    if (nome.length < 2 || nome.length > 100 || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    items.push({ nome, quantidade: cleanQuantity(source.quantidade) });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

/** Lê a foto com IA de visão. A imagem fica só em memória durante a chamada. */
export async function readReceiptWithAI(imageDataUrl: string): Promise<ReceiptAiItem[]> {
  const result = await callVisionAI(SYSTEM_PROMPT, 'Liste os produtos desta imagem com a quantidade.', imageDataUrl, {
    maxTokens: 4000,
  });
  return cleanReceiptItems(result);
}
