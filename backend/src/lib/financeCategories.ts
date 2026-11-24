import { callAI } from './ai';

export interface FinanceCategory {
  _id?: unknown;
  nome: string;
  nomeNormalizado?: string;
  sinonimos: string[];
  criadoPor?: 'ia' | 'user';
  criadoEm?: Date;
  atualizadoEm?: Date;
}

export interface CategorySuggestion {
  categoria: string;
  confianca: number;
  existente: boolean;
  fonte: 'match' | 'ia' | 'fallback';
}

export const DEFAULT_CATEGORIES: Array<Pick<FinanceCategory, 'nome' | 'sinonimos'>> = [
  { nome: 'Mercado', sinonimos: ['supermercado', 'mercearia', 'hortifruti', 'feira'] },
  { nome: 'Restaurante', sinonimos: ['lanchonete', 'pizzaria', 'hamburgueria', 'delivery', 'restaurantes'] },
  { nome: 'Sorveteria', sinonimos: ['picolé', 'sorvete', 'açaí', 'acai', 'gelateria'] },
  { nome: 'Farmácia', sinonimos: ['drogaria', 'medicamentos', 'remédios'] },
  { nome: 'Transporte', sinonimos: ['uber', '99', 'taxi', 'ônibus', 'combustível', 'gasolina'] },
  { nome: 'Moradia', sinonimos: ['aluguel', 'condomínio', 'contas de casa'] },
  { nome: 'Lazer', sinonimos: ['cinema', 'parque', 'show', 'viagem'] },
  { nome: 'Outros', sinonimos: [] },
];

export function normalizeCategoryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length < 4 || word.endsWith('us')) return word;
      if (word.endsWith('oes')) return `${word.slice(0, -3)}ao`;
      if (word.endsWith('aes')) return `${word.slice(0, -3)}ao`;
      if (word.endsWith('s')) return word.slice(0, -1);
      return word;
    })
    .join(' ');
}

function includesPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function findSimilarCategory<T extends FinanceCategory>(
  description: string,
  categories: readonly T[]
): T | undefined {
  const query = normalizeCategoryName(description);
  if (!query) return undefined;

  const normalizedNames = categories.map((category) => ({
    category,
    name: normalizeCategoryName(category.nome),
    synonyms: (Array.isArray(category.sinonimos) ? category.sinonimos : [])
      .map(normalizeCategoryName)
      .filter(Boolean),
  }));
  const exactName = normalizedNames.find(({ name }) => name === query);
  if (exactName) return exactName.category;

  const exactSynonym = normalizedNames.find(({ synonyms }) => synonyms.includes(query));
  if (exactSynonym) return exactSynonym.category;

  const matchingName = normalizedNames.find(({ name }) => includesPhrase(query, name));
  if (matchingName) return matchingName.category;

  return normalizedNames.find(({ synonyms }) =>
    synonyms.some((synonym) => includesPhrase(query, synonym))
  )?.category;
}

function titleCaseCategory(value: string): string {
  const smallWords = new Set(['a', 'as', 'ao', 'aos', 'da', 'das', 'de', 'do', 'dos', 'e', 'em']);
  const words = value.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-BR');
      return index > 0 && smallWords.has(lower)
        ? lower
        : lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join(' ');
}

function confidence(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

export async function suggestExpenseCategory(
  description: string,
  categories: readonly FinanceCategory[],
  requestAI: typeof callAI = callAI
): Promise<CategorySuggestion> {
  const match = findSimilarCategory(description, categories);
  if (match) return { categoria: match.nome, confianca: 1, existente: true, fonte: 'match' };

  try {
    const response = await requestAI(
      `Classifique uma despesa em português brasileiro. Primeiro identifique o produto, serviço ou tipo de estabelecimento da descrição. Escolha a categoria existente mais próxima quando fizer sentido. Caso nenhuma sirva, sugira uma categoria nova curta, capitalizada e específica. Para "loja de fogos", a categoria é "Loja de Fogos", não "Outros". Só use "Outros" se a descrição não permitir identificar nenhum tipo de compra ou estabelecimento. Não invente uma categoria genérica quando uma existente for adequada. Retorne somente JSON: {"categoria":"Nome","confianca":0.0}. Categorias existentes: ${JSON.stringify(categories.map(({ nome }) => nome))}`,
      `Descrição: ${description}`,
      { temperature: 0, maxTokens: 100 }
    );
    if (!response || typeof response !== 'object') throw new Error('invalid_category_response');
    const data = response as { categoria?: unknown; confianca?: unknown };
    if (typeof data.categoria !== 'string' || !data.categoria.trim() || data.categoria.trim().length > 80) {
      throw new Error('invalid_category_response');
    }
    if (!normalizeCategoryName(data.categoria)) throw new Error('invalid_category_response');

    const aiMatch = findSimilarCategory(data.categoria, categories);
    if (aiMatch) {
      return {
        categoria: aiMatch.nome,
        confianca: confidence(data.confianca, 0.8),
        existente: true,
        fonte: 'ia',
      };
    }
    return {
      categoria: titleCaseCategory(data.categoria),
      confianca: confidence(data.confianca, 0.7),
      existente: false,
      fonte: 'ia',
    };
  } catch {
    const fallback = categories.find((category) => normalizeCategoryName(category.nome) === 'outro');
    return {
      categoria: fallback?.nome ?? 'Outros',
      confianca: 0,
      existente: Boolean(fallback),
      fonte: 'fallback',
    };
  }
}
