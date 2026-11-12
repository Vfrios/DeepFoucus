import { NextFunction, Request, Response, Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import { getItemEmoji } from '../lib/icons';
import { notifyAndroid } from '../lib/realtime';
import { addShoppingItem, generateRecipe, Recipe, ShoppingItem, ShoppingNormalizationError, ShoppingStatus } from '../lib/shopping';
import { apiTokenAuth } from '../middleware/apiToken';
import { jwtAuth } from '../middleware/jwtAuth';
import { requireRole } from '../middleware/requireRole';

const r = Router();

function shoppingAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/add' && req.header('x-api-token')) { apiTokenAuth(req, res, next); return; }
  jwtAuth(req, res, () => requireRole(['owner', 'finance', 'guest'])(req, res, next));
}

function validStatus(value: unknown): value is ShoppingStatus { return value === 'dispensa' || value === 'carrinho'; }

function missingEmoji(item: ShoppingItem): boolean {
  return typeof item.emoji !== 'string' || !item.emoji.trim();
}

async function repairMissingEmojis(): Promise<number> {
  const collection = (await getDb()).collection<ShoppingItem>('shopping');
  const items = await collection.find({
    $or: [{ emoji: { $exists: false } }, { emoji: null }, { emoji: '' }],
  }).toArray();
  if (!items.length) return 0;

  await collection.bulkWrite(items.map((item) => ({
    updateOne: {
      filter: { _id: item._id },
      update: { $set: { emoji: getItemEmoji(item.item) } },
    },
  })));
  return items.length;
}

r.use(shoppingAuth);

r.post('/add', async (req, res, next) => {
  const input = req.body?.item;
  const status = req.body?.status ?? 'carrinho';
  const quantidade = req.body?.quantidade ?? '1';
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 200 || !validStatus(status)
    || typeof quantidade !== 'string' || quantidade.trim().length > 80) {
    res.status(400).json({ error: 'item, quantidade ou status inválido' }); return;
  }
  try {
    const item = await addShoppingItem(input.trim(), status, quantidade);
    res.status(201).json({ ...item, _id: String(item._id), sucesso: true, mensagem: 'Item adicionado' });
  } catch (error) {
    if (error instanceof ShoppingNormalizationError) { res.status(502).json({ error: 'ai_unavailable' }); return; }
    next(error);
  }
});

r.get('/list', async (_req, res, next) => {
  try {
    const collection = (await getDb()).collection<ShoppingItem>('shopping');
    const items = await collection.find().sort({ criadoEm: -1 }).toArray();
    const itemsWithoutEmoji = items.filter(missingEmoji);
    if (itemsWithoutEmoji.length) {
      await collection.bulkWrite(itemsWithoutEmoji.map((item) => {
        const emoji = getItemEmoji(item.item);
        item.emoji = emoji;
        return { updateOne: { filter: { _id: item._id }, update: { $set: { emoji } } } };
      }));
    }
    const serialized = items.map((item) => ({ ...item, _id: String(item._id) }));
    res.json({
      dispensa: serialized.filter((item) => item.status === 'dispensa'),
      carrinho: serialized.filter((item) => item.status === 'carrinho'),
    });
  } catch (error) { next(error); }
});

r.post('/fix-emojis', async (_req, res, next) => {
  try {
    const atualizados = await repairMissingEmojis();
    if (atualizados) notifyAndroid('RELOAD_SHOPPING');
    res.json({ ok: true, atualizados });
  } catch (error) { next(error); }
});

r.post('/checkout', async (_req, res, next) => {
  try {
    const result = await (await getDb()).collection<ShoppingItem>('shopping').updateMany({ status: 'carrinho' }, { $set: { status: 'dispensa' } });
    notifyAndroid('RELOAD_SHOPPING');
    res.json({ ok: true, movidos: result.modifiedCount });
  } catch (error) { next(error); }
});

r.post('/recipe', async (req, res, next) => {
  const prato = req.body?.prato;
  if (typeof prato !== 'string' || !prato.trim() || prato.trim().length > 200) { res.status(400).json({ error: 'prato inválido' }); return; }
  try {
    const db = await getDb();
    const pantry = await db.collection<ShoppingItem>('shopping').find({ status: 'dispensa' }).toArray();
    const recipe = await generateRecipe(prato.trim(), pantry);
    const criadoEm = new Date();
    const recipeResult = await db.collection<Recipe>('recipes').insertOne({ ...recipe, criadoEm });
    if (recipe.ingredientesFaltantes.length) {
      await db.collection<ShoppingItem>('shopping').insertMany(recipe.ingredientesFaltantes.map(({ item, quantidade }) => ({
        item, emoji: getItemEmoji(item), quantidade, status: 'carrinho' as const, criadoEm,
      })));
    }
    notifyAndroid('RELOAD_SHOPPING');
    res.status(201).json({ ...recipe, _id: String(recipeResult.insertedId), criadoEm, itensAdicionados: recipe.ingredientesFaltantes.length });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('recipe_invalid_')) { res.status(502).json({ error: 'resposta_inválida_da_ia' }); return; }
    console.error('[shopping] recipe generation failed:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'ai_unavailable' });
  }
});

r.delete('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'id inválido' }); return; }
  try {
    const result = await (await getDb()).collection<ShoppingItem>('shopping').deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) { res.status(404).json({ error: 'item não encontrado' }); return; }
    notifyAndroid('RELOAD_SHOPPING');
    res.status(204).end();
  } catch (error) { next(error); }
});

export default r;
