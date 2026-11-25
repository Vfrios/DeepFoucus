import { callVisionAI } from './ai';

const MAX_ITEMS = 30;
export const MAX_RECEIPT_IMAGE_CHARS = 3_500_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const SYSTEM_PROMPT =
  'Você lê fotos de listas de compras escritas à mão ou de notas fiscais de mercado, em português do Brasil. ' +
  'Extraia SOMENTE os nomes dos produtos, corrigindo erros de escrita ou de leitura. ' +
  'Ignore preços, totais, datas, CNPJ, cabeçalhos, desenhos e rabiscos. A foto pode estar girada. ' +
  'Um produto por item, com capitalização natural (ex.: "Molho de Tomate"). ' +
  'Responda apenas com JSON no formato {"itens":["Leite","Queijo"]}; se não houver produtos, {"itens":[]}.';

export function isReceiptImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_RECEIPT_IMAGE_CHARS && IMAGE_DATA_URL.test(value);
}

function itemKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '');
}

/** Valida e limpa a resposta da IA: strings curtas, sem duplicatas, no máximo 30. */
export function cleanReceiptItems(raw: unknown): string[] {
  const list = (raw as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const name = entry.replace(/\s+/g, ' ').trim();
    const key = itemKey(name);
    if (name.length < 2 || name.length > 100 || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    items.push(name);
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

/** Lê a foto com IA de visão. A imagem fica só em memória durante a chamada. */
export async function readReceiptWithAI(imageDataUrl: string): Promise<string[]> {
  const result = await callVisionAI(SYSTEM_PROMPT, 'Liste os produtos desta imagem.', imageDataUrl, { maxTokens: 600 });
  return cleanReceiptItems(result);
}
