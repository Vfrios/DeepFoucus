import { Collection, ObjectId } from 'mongodb';
import { callAI } from './ai';
import { getItemEmoji } from './icons';
import { getDb } from './mongo';
import { notifyAndroid } from './realtime';

export type ShoppingStatus = 'dispensa' | 'carrinho';
export type ShoppingAdjustContext = 'dispensa' | 'carrinho';

export interface ShoppingItem {
  _id?: ObjectId;
  item: string;
  emoji?: string | null;
  quantidade: string;
  status: ShoppingStatus;
  quantidadeEmCasa?: number;
  quantidadeNoCarrinho?: number;
  naDispensa?: boolean;
  criadoEm: Date;
}

export function parseQuantityNumber(value: unknown, fallback = 1): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const match = trimmed.match(/^(\d+)/);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  }
  return fallback;
}

export function getQuantidadeEmCasa(item: ShoppingItem): number {
  if (typeof item.quantidadeEmCasa === 'number' && Number.isFinite(item.quantidadeEmCasa)) {
    return Math.max(0, Math.round(item.quantidadeEmCasa));
  }
  if (item.status === 'dispensa') {
    return parseQuantityNumber(item.quantidade, 1);
  }
  return 0;
}

export function getQuantidadeNoCarrinho(item: ShoppingItem): number {
  if (typeof item.quantidadeNoCarrinho === 'number' && Number.isFinite(item.quantidadeNoCarrinho)) {
    return Math.max(0, Math.round(item.quantidadeNoCarrinho));
  }
  if (item.status === 'carrinho') {
    return parseQuantityNumber(item.quantidade, 1);
  }
  return 0;
}

export function isItemInDispensa(item: ShoppingItem): boolean {
  if (typeof item.quantidadeEmCasa === 'number') {
    return item.quantidadeEmCasa > 0;
  }
  if (item.naDispensa === true) return parseQuantityNumber(item.quantidade, 1) > 0;
  if (item.status === 'dispensa') return parseQuantityNumber(item.quantidade, 1) > 0;
  return false;
}

export function isItemInCarrinho(item: ShoppingItem): boolean {
  if (typeof item.quantidadeNoCarrinho === 'number') {
    return item.quantidadeNoCarrinho > 0;
  }
  return item.status === 'carrinho';
}

export function ingredientKey(item: string): string {
  return item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

export async function consolidateDuplicateShoppingItems(collection: Collection<ShoppingItem>): Promise<void> {
  const items = await collection.find().toArray();
  const groups = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = ingredientKey(item.item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = group
      .slice()
      .sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
    if (!canonical._id) continue;

    const quantidadeEmCasa = group.reduce((total, item) => total + getQuantidadeEmCasa(item), 0);
    const quantidadeNoCarrinho = group.reduce((total, item) => total + getQuantidadeNoCarrinho(item), 0);
    const naDispensa = quantidadeEmCasa > 0;
    const status: ShoppingStatus = quantidadeNoCarrinho > 0 ? 'carrinho' : 'dispensa';
    await collection.updateOne(
      { _id: canonical._id },
      {
        $set: {
          item: canonical.item,
          emoji: canonical.emoji || getItemEmoji(canonical.item),
          quantidadeEmCasa,
          quantidadeNoCarrinho,
          naDispensa,
          status,
          quantidade: String(status === 'carrinho' ? (quantidadeNoCarrinho || quantidadeEmCasa || 1) : (quantidadeEmCasa || 1)),
        },
      }
    );
    await collection.deleteMany({
      _id: { $in: group.filter((item) => item._id && !item._id.equals(canonical._id)).map((item) => item._id as ObjectId) },
    });
  }
}

export interface RecipeIngredient { item: string; quantidade: string }
export interface Recipe {
  _id?: ObjectId;
  prato: string;
  ingredientesDisponiveis: RecipeIngredient[];
  ingredientesFaltantes: RecipeIngredient[];
  instrucoes: string[];
  criadoEm: Date;
}

export class ShoppingNormalizationError extends Error {
  constructor() { super('shopping_item_normalization_failed'); this.name = 'ShoppingNormalizationError'; }
}

export async function normalizeShoppingItem(input: string): Promise<string> {
  const fallback = input.trim().replace(/\s+/g, ' ');
  try {
    const result = await callAI(
      'Normalize the supplied grocery product name in Brazilian Portuguese. Preserve its meaning and quantity. Return only a JSON object like {"item":"Product Name"} with natural title capitalization.',
      input,
      { temperature: 0, maxTokens: 100 }
    );
    const item = (result as { item?: unknown })?.item;
    if (typeof item === 'string' && item.trim() && item.trim().length <= 200) {
      return item.trim().replace(/\s+/g, ' ');
    }
  } catch (error) {
    console.warn('[shopping] Falha ao normalizar nome do item com IA, usando texto original:', error instanceof Error ? error.message : error);
  }
  return fallback;
}

export async function addShoppingItem(
  input: string,
  status: ShoppingStatus = 'carrinho',
  quantidade = '1',
  options: { normalize?: boolean } = {}
): Promise<ShoppingItem> {
  const item = options.normalize === false ? input.trim() : await normalizeShoppingItem(input);
  if (!item || item.length > 200) throw new Error('invalid_shopping_item');
  const cleanQty = quantidade.trim().slice(0, 80) || '1';
  const numericQty = parseQuantityNumber(cleanQty, 1);
  const collection = (await getDb()).collection<ShoppingItem>('shopping');
  await consolidateDuplicateShoppingItems(collection);
  const existingItems = await collection.find().toArray();
  const key = ingredientKey(item);
  const existing = existingItems.find((entry) => ingredientKey(entry.item) === key);

  if (existing && existing._id) {
    const emCasa = getQuantidadeEmCasa(existing);
    const noCarrinho = getQuantidadeNoCarrinho(existing);
    const inDispensa = isItemInDispensa(existing);

    const nextEmCasa = status === 'dispensa' ? emCasa + numericQty : emCasa;
    const nextNoCarrinho = status === 'carrinho' ? noCarrinho + numericQty : noCarrinho;
    const nextNaDispensa = status === 'dispensa' ? true : inDispensa;
    const nextStatus: ShoppingStatus = status === 'carrinho' ? 'carrinho' : (nextNoCarrinho > 0 ? 'carrinho' : 'dispensa');
    const nextQuantidade = status === 'carrinho'
      ? (noCarrinho > 0 ? String(nextNoCarrinho) : cleanQty)
      : String(nextEmCasa);

    const updated = await collection.findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          item: existing.item || item,
          emoji: existing.emoji || getItemEmoji(item),
          quantidade: nextQuantidade,
          status: nextStatus,
          quantidadeEmCasa: nextEmCasa,
          quantidadeNoCarrinho: nextNoCarrinho,
          naDispensa: nextNaDispensa,
        },
      },
      { returnDocument: 'after' }
    );
    notifyAndroid('RELOAD_SHOPPING');
    if (updated) return updated;
  }

  const document: ShoppingItem = {
    item,
    emoji: getItemEmoji(item),
    quantidade: cleanQty,
    status,
    quantidadeEmCasa: status === 'dispensa' ? numericQty : 0,
    quantidadeNoCarrinho: status === 'carrinho' ? numericQty : 0,
    naDispensa: status === 'dispensa',
    criadoEm: new Date(),
  };
  const result = await collection.insertOne(document);
  document._id = result.insertedId;
  notifyAndroid('RELOAD_SHOPPING');
  return document;
}

function cleanIngredient(value: unknown): RecipeIngredient | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.item !== 'string' || !raw.item.trim() || raw.item.trim().length > 200
    || typeof raw.quantidade !== 'string' || !raw.quantidade.trim() || raw.quantidade.trim().length > 80) return null;
  return {
    item: raw.item.trim().replace(/\s+/g, ' '),
    quantidade: raw.quantidade.trim().replace(/\s+/g, ' '),
  };
}

function cleanIngredientList(value: unknown): RecipeIngredient[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('recipe_invalid_ingredients');
  const cleaned = value.map(cleanIngredient).filter((item): item is RecipeIngredient => item !== null);
  if (cleaned.length !== value.length) throw new Error('recipe_invalid_ingredients');
  return cleaned;
}

export function validateRecipe(value: unknown, prato: string): Omit<Recipe, '_id' | 'criadoEm'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('recipe_invalid_json');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.instrucoes) || !raw.instrucoes.length || raw.instrucoes.length > 30
    || raw.instrucoes.some((step) => typeof step !== 'string' || !step.trim() || step.trim().length > 500)) {
    throw new Error('recipe_invalid_instructions');
  }
  const ingredientesDisponiveis = cleanIngredientList(raw.ingredientesDisponiveis);
  const ingredientesFaltantes = cleanIngredientList(raw.ingredientesFaltantes);
  const availableKeys = new Set(ingredientesDisponiveis.map(({ item }) => ingredientKey(item)));
  if (ingredientesFaltantes.some(({ item }) => availableKeys.has(ingredientKey(item)))) {
    throw new Error('recipe_invalid_ingredient_conflict');
  }
  const instrucoes = raw.instrucoes.map((step) => (step as string).trim().replace(/\s+/g, ' '));
  return { prato, ingredientesDisponiveis, ingredientesFaltantes, instrucoes };
}

export async function generateRecipe(prato: string, pantry: ShoppingItem[]): Promise<Omit<Recipe, '_id' | 'criadoEm'>> {
  const response = await callAI(
    'Você é um assistente culinário. Retorne APENAS JSON estrito, sem markdown, exatamente no formato {"ingredientesDisponiveis":[{"item":"...","quantidade":"..."}],"ingredientesFaltantes":[{"item":"...","quantidade":"..."}],"instrucoes":["..."]}. Considere disponíveis somente os itens informados na dispensa. Não inclua um mesmo ingrediente nas duas listas. As instruções devem ser curtas, seguras e em português do Brasil.',
    JSON.stringify({ pedido: `O usuário quer fazer ${prato}.`, dispensa: pantry.map(({ item, quantidade }) => ({ item, quantidade })) }),
    { temperature: 0.2, maxTokens: 1400 }
  );
  return validateRecipe(response, prato);
}
