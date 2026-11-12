import { ObjectId } from 'mongodb';
import { callAI } from './ai';
import { getItemEmoji } from './icons';
import { getDb } from './mongo';
import { notifyAndroid } from './realtime';

export type ShoppingStatus = 'dispensa' | 'carrinho';

export interface ShoppingItem {
  _id?: ObjectId;
  item: string;
  emoji?: string | null;
  quantidade: string;
  status: ShoppingStatus;
  criadoEm: Date;
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
  let result: unknown;
  try {
    result = await callAI(
      'Normalize the supplied grocery product name in Brazilian Portuguese. Preserve its meaning and quantity. Return only JSON in the form {"item":"Product Name"} with natural title capitalization.',
      input,
      { temperature: 0, maxTokens: 100 }
    );
  } catch { throw new ShoppingNormalizationError(); }
  const item = (result as { item?: unknown })?.item;
  if (typeof item !== 'string' || !item.trim() || item.trim().length > 200) throw new Error('invalid_shopping_item_from_ai');
  return item.trim().replace(/\s+/g, ' ');
}

export async function addShoppingItem(input: string, status: ShoppingStatus = 'carrinho', quantidade = '1'): Promise<ShoppingItem> {
  const item = await normalizeShoppingItem(input);
  const document: ShoppingItem = { item, emoji: getItemEmoji(item), quantidade: quantidade.trim().slice(0, 80) || '1', status, criadoEm: new Date() };
  const result = await (await getDb()).collection<ShoppingItem>('shopping').insertOne(document);
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

function ingredientKey(item: string): string {
  return item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
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
