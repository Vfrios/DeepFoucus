import { ObjectId } from 'mongodb';
import { callAI } from './ai';
import { getDb } from './mongo';
import { notifyAndroid } from './realtime';
import { getItemEmoji } from './icons';

export interface ShoppingItem {
  _id?: ObjectId;
  item: string;
  emoji?: string;
  comprado: boolean;
  criadoEm: Date;
}

export class ShoppingNormalizationError extends Error {
  constructor() {
    super('shopping_item_normalization_failed');
    this.name = 'ShoppingNormalizationError';
  }
}

export async function normalizeShoppingItem(input: string): Promise<string> {
  let result: unknown;
  try {
    result = await callAI(
      'Normalize the supplied grocery product name in Brazilian Portuguese. Preserve its meaning and quantity. Return only JSON in the form {"item":"Product Name"} with natural title capitalization.',
      input,
      { temperature: 0, maxTokens: 100 }
    );
  } catch {
    throw new ShoppingNormalizationError();
  }
  const item = (result as { item?: unknown })?.item;
  if (typeof item !== 'string' || !item.trim() || item.trim().length > 200) {
    throw new Error('invalid_shopping_item_from_ai');
  }
  return item.trim().replace(/\s+/g, ' ');
}

export async function addShoppingItem(input: string): Promise<ShoppingItem> {
  const item = await normalizeShoppingItem(input);
  const document: ShoppingItem = {
    item,
    emoji: getItemEmoji(item),
    comprado: false,
    criadoEm: new Date(),
  };
  const result = await (await getDb()).collection<ShoppingItem>('shopping_list').insertOne(document);
  document._id = result.insertedId;
  notifyAndroid('RELOAD_SHOPPING');
  return document;
}
