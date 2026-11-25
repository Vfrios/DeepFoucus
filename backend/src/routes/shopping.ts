import { NextFunction, Request, Response, Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import { getItemEmoji } from '../lib/icons';
import { notifyAndroid } from '../lib/realtime';
import { isReceiptImageDataUrl, readReceiptWithAI } from '../lib/receiptAi';
import {
  addShoppingItem,
  generateRecipe,
  consolidateDuplicateShoppingItems,
  getQuantidadeEmCasa,
  getQuantidadeNoCarrinho,
  ingredientKey,
  isItemInCarrinho,
  isItemInDispensa,
  parseQuantityNumber,
  Recipe,
  ShoppingItem,
  ShoppingNormalizationError,
  ShoppingStatus,
} from '../lib/shopping';
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
  const rawQuantidade = req.body?.quantidade;
  const quantidade = rawQuantidade === undefined || rawQuantidade === null || String(rawQuantidade).trim() === ''
    ? '1'
    : String(rawQuantidade).trim();
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 200 || !validStatus(status)
    || quantidade.length > 80) {
    res.status(400).json({ error: 'item, quantidade ou status inválido' }); return;
  }
  try {
    const item = await addShoppingItem(input.trim(), status, quantidade);
    res.status(201).json({
      ...item,
      _id: String(item._id),
      quantidade: item.quantidade || '1',
      quantidadeEmCasa: getQuantidadeEmCasa(item),
      quantidadeNoCarrinho: getQuantidadeNoCarrinho(item),
      sucesso: true,
      mensagem: 'Item adicionado',
    });
  } catch (error) {
    if (error instanceof ShoppingNormalizationError) { res.status(502).json({ error: 'ai_unavailable' }); return; }
    next(error);
  }
});

r.get('/list', async (_req, res, next) => {
  try {
    const collection = (await getDb()).collection<ShoppingItem>('shopping');
    await consolidateDuplicateShoppingItems(collection);
    const items = await collection.find().sort({ criadoEm: -1 }).toArray();
    const itemsWithoutEmoji = items.filter(missingEmoji);
    if (itemsWithoutEmoji.length) {
      await collection.bulkWrite(itemsWithoutEmoji.map((item) => {
        const emoji = getItemEmoji(item.item);
        item.emoji = emoji;
        return { updateOne: { filter: { _id: item._id }, update: { $set: { emoji } } } };
      }));
    }

    const dispensa = items
      .filter((item) => isItemInDispensa(item))
      .map((item) => {
        const emCasa = getQuantidadeEmCasa(item);
        const noCarrinho = getQuantidadeNoCarrinho(item);
        return {
          ...item,
          _id: String(item._id),
          status: 'dispensa' as const,
          quantidadeEmCasa: emCasa,
          quantidadeNoCarrinho: noCarrinho,
          quantidade: String(emCasa),
        };
      });

    const carrinho = items
      .filter((item) => isItemInCarrinho(item))
      .map((item) => {
        const emCasa = getQuantidadeEmCasa(item);
        const noCarrinho = getQuantidadeNoCarrinho(item);
        const rawQty = item.quantidade || '1';
        const displayQty = parseQuantityNumber(rawQty, 1) === noCarrinho ? rawQty : String(noCarrinho || 1);
        return {
          ...item,
          _id: String(item._id),
          status: 'carrinho' as const,
          quantidadeEmCasa: emCasa,
          quantidadeNoCarrinho: noCarrinho,
          quantidade: displayQty,
        };
      });

    res.json({ dispensa, carrinho });
  } catch (error) { next(error); }
});

r.post('/receipt-scan', async (req, res) => {
  const image = req.body?.image;
  if (!isReceiptImageDataUrl(image)) {
    res.status(400).json({ error: 'invalid_receipt_image' });
    return;
  }
  try {
    // A imagem não é gravada em banco nem em disco: vive só na memória desta requisição.
    res.json({ itens: await readReceiptWithAI(image) });
  } catch {
    res.status(502).json({ error: 'ai_unavailable' });
  }
});

r.post('/pantry/import', async (req, res, next) => {
  const rawItems = req.body?.itens;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 40) {
    res.status(400).json({ error: 'invalid_receipt_items' });
    return;
  }

  const items = rawItems.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const name = typeof item.item === 'string' ? item.item.trim() : '';
    const quantity = typeof item.quantidade === 'string' ? item.quantidade.trim() : '';
    if (!name || name.length > 200 || !/^\d{1,6}$/.test(quantity) || Number(quantity) < 1) return null;
    return { name, quantity };
  });
  if (items.some((item) => item === null)) {
    res.status(400).json({ error: 'invalid_receipt_items' });
    return;
  }

  try {
    for (const item of items) {
      if (!item) continue;
      await addShoppingItem(item.name, 'dispensa', item.quantity, { normalize: false });
    }
    res.json({ adicionados: items.length });
  } catch (error) {
    next(error);
  }
});

r.post('/fix-emojis', async (_req, res, next) => {
  try {
    const atualizados = await repairMissingEmojis();
    if (atualizados) notifyAndroid('RELOAD_SHOPPING');
    res.json({ ok: true, atualizados });
  } catch (error) { next(error); }
});

r.patch('/adjust', async (req, res, next) => {
  const { itemId, delta, contexto } = req.body ?? {};
  if (typeof itemId !== 'string' || !ObjectId.isValid(itemId)) {
    res.status(400).json({ error: 'itemId inválido' }); return;
  }
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
    res.status(400).json({ error: 'delta inválido' }); return;
  }
  if (!validStatus(contexto)) {
    res.status(400).json({ error: 'contexto inválido' }); return;
  }

  try {
    const collection = (await getDb()).collection<ShoppingItem>('shopping');
    const existing = await collection.findOne({ _id: new ObjectId(itemId) });
    if (!existing) {
      res.status(404).json({ error: 'item não encontrado' }); return;
    }

    const currentEmCasa = getQuantidadeEmCasa(existing);
    const currentNoCarrinho = getQuantidadeNoCarrinho(existing);
    const currentNaDispensa = isItemInDispensa(existing);

    const nextEmCasa = contexto === 'dispensa'
      ? Math.max(0, currentEmCasa + Math.round(delta))
      : currentEmCasa;
    const nextNoCarrinho = contexto === 'carrinho'
      ? Math.max(0, currentNoCarrinho + Math.round(delta))
      : currentNoCarrinho;
    const nextNaDispensa = contexto === 'dispensa' ? nextEmCasa > 0 : currentNaDispensa && currentEmCasa > 0;
    const nextStatus: ShoppingStatus = nextNoCarrinho > 0 ? 'carrinho' : 'dispensa';
    const nextQuantidade = contexto === 'carrinho'
      ? String(nextNoCarrinho > 0 ? nextNoCarrinho : nextEmCasa)
      : (nextNoCarrinho > 0 ? existing.quantidade : String(nextEmCasa));

    const updated = await collection.findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          quantidadeEmCasa: nextEmCasa,
          quantidadeNoCarrinho: nextNoCarrinho,
          naDispensa: nextNaDispensa,
          status: nextStatus,
          quantidade: nextQuantidade,
        },
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      res.status(404).json({ error: 'item não encontrado' }); return;
    }

    notifyAndroid('RELOAD_SHOPPING');
    res.json({
      ...updated,
      _id: String(updated._id),
      quantidadeEmCasa: nextEmCasa,
      quantidadeNoCarrinho: nextNoCarrinho,
      quantidade: contexto === 'dispensa' ? String(nextEmCasa) : String(nextNoCarrinho || 1),
    });
  } catch (error) { next(error); }
});

r.post('/checkout', async (_req, res, next) => {
  try {
    const collection = (await getDb()).collection<ShoppingItem>('shopping');
    const allItems = await collection.find().toArray();
    const cartItems = allItems.filter((item) => isItemInCarrinho(item));

    if (!cartItems.length) {
      res.json({ ok: true, movidos: 0 });
      return;
    }

    const cartIds = new Set(cartItems.map((item) => String(item._id)));
    const nonCartPantryByKey = new Map<string, ShoppingItem>();
    for (const item of allItems) {
      if (!cartIds.has(String(item._id)) && isItemInDispensa(item)) {
        const key = ingredientKey(item.item);
        if (!nonCartPantryByKey.has(key)) nonCartPantryByKey.set(key, item);
      }
    }

    const ops: Array<
      | { updateOne: { filter: { _id: ObjectId }; update: { $set: Partial<ShoppingItem> } } }
      | { deleteOne: { filter: { _id: ObjectId } } }
    > = [];

    for (const cartItem of cartItems) {
      if (!cartItem._id) continue;
      const comprado = Math.max(1, getQuantidadeNoCarrinho(cartItem));
      const key = ingredientKey(cartItem.item);
      const separatePantryItem = nonCartPantryByKey.get(key);

      if (separatePantryItem && separatePantryItem._id) {
        const novaQuantidadeEmCasa = getQuantidadeEmCasa(separatePantryItem) + getQuantidadeEmCasa(cartItem) + comprado;
        separatePantryItem.quantidadeEmCasa = novaQuantidadeEmCasa;
        ops.push({
          updateOne: {
            filter: { _id: separatePantryItem._id },
            update: {
              $set: {
                quantidadeEmCasa: novaQuantidadeEmCasa,
                quantidadeNoCarrinho: 0,
                naDispensa: true,
                status: 'dispensa',
                quantidade: String(novaQuantidadeEmCasa),
              },
            },
          },
        });
        ops.push({
          deleteOne: {
            filter: { _id: cartItem._id },
          },
        });
      } else {
        const novaQuantidadeEmCasa = getQuantidadeEmCasa(cartItem) + comprado;
        ops.push({
          updateOne: {
            filter: { _id: cartItem._id },
            update: {
              $set: {
                quantidadeEmCasa: novaQuantidadeEmCasa,
                quantidadeNoCarrinho: 0,
                naDispensa: true,
                status: 'dispensa',
                quantidade: String(novaQuantidadeEmCasa),
              },
            },
          },
        });
      }
    }

    if (ops.length) {
      await collection.bulkWrite(ops);
    }

    notifyAndroid('RELOAD_SHOPPING');
    res.json({ ok: true, movidos: cartItems.length });
  } catch (error) { next(error); }
});

r.post('/recipe', async (req, res, next) => {
  const prato = req.body?.prato;
  if (typeof prato !== 'string' || !prato.trim() || prato.trim().length > 200) { res.status(400).json({ error: 'prato inválido' }); return; }
  try {
    const db = await getDb();
    const collection = db.collection<ShoppingItem>('shopping');
    const allItems = await collection.find().toArray();
    const pantry = allItems
      .filter((item) => isItemInDispensa(item) && getQuantidadeEmCasa(item) > 0)
      .map((item) => ({ ...item, quantidade: String(getQuantidadeEmCasa(item)) }));

    const recipe = await generateRecipe(prato.trim(), pantry);
    const criadoEm = new Date();
    const recipeResult = await db.collection<Recipe>('recipes').insertOne({ ...recipe, criadoEm });

    for (const { item, quantidade } of recipe.ingredientesDisponiveis) {
      const key = ingredientKey(item);
      const pantryItem = allItems.find((entry) => ingredientKey(entry.item) === key);
      if (!pantryItem?._id) continue;
      const emCasaAtual = getQuantidadeEmCasa(pantryItem);
      const consumido = parseQuantityNumber(quantidade, 1);
      const emCasaRestante = Math.max(0, emCasaAtual - consumido);
      const noCarrinho = getQuantidadeNoCarrinho(pantryItem);
      await collection.updateOne(
        { _id: pantryItem._id },
        {
          $set: {
            quantidadeEmCasa: emCasaRestante,
            quantidadeNoCarrinho: noCarrinho,
            naDispensa: emCasaRestante > 0,
            status: noCarrinho > 0 ? 'carrinho' : 'dispensa',
            quantidade: emCasaRestante > 0 ? String(emCasaRestante) : String(noCarrinho || 1),
          },
        }
      );
      pantryItem.quantidadeEmCasa = emCasaRestante;
      pantryItem.naDispensa = emCasaRestante > 0;
    }

    if (recipe.ingredientesFaltantes.length) {
      for (const { item, quantidade } of recipe.ingredientesFaltantes) {
        const key = ingredientKey(item);
        const existing = allItems.find((entry) => ingredientKey(entry.item) === key);
        const addedQty = parseQuantityNumber(quantidade, 1);
        if (existing && existing._id) {
          const nextNoCarrinho = getQuantidadeNoCarrinho(existing) + addedQty;
          await collection.updateOne(
            { _id: existing._id },
            {
              $set: {
                quantidadeNoCarrinho: nextNoCarrinho,
                status: 'carrinho',
                quantidade: String(nextNoCarrinho),
                naDispensa: getQuantidadeEmCasa(existing) > 0,
              },
            }
          );
          existing.quantidadeNoCarrinho = nextNoCarrinho;
        } else {
          await collection.insertOne({
            item,
            emoji: getItemEmoji(item),
            quantidade,
            status: 'carrinho',
            quantidadeEmCasa: 0,
            quantidadeNoCarrinho: addedQty,
            naDispensa: false,
            criadoEm,
          });
        }
      }
    }
    notifyAndroid('RELOAD_SHOPPING');
    res.status(201).json({ ...recipe, _id: String(recipeResult.insertedId), criadoEm, itensAdicionados: recipe.ingredientesFaltantes.length });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('recipe_invalid_')) { res.status(502).json({ error: 'resposta_inválida_da_ia' }); return; }
    console.error('[shopping] recipe generation failed:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'ai_unavailable' });
  }
});

r.patch('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'id inválido' }); return; }
  const update: Partial<ShoppingItem> = {};

  if (req.body?.quantidade !== undefined) {
    const rawQty = String(req.body.quantidade).trim();
    if (rawQty.length > 80) { res.status(400).json({ error: 'quantidade inválida' }); return; }
    update.quantidade = rawQty || '1';
  }

  if (req.body?.status !== undefined) {
    if (!validStatus(req.body.status)) { res.status(400).json({ error: 'status inválido' }); return; }
    update.status = req.body.status;
  }

  if (req.body?.item !== undefined) {
    if (typeof req.body.item !== 'string' || !req.body.item.trim() || req.body.item.trim().length > 200) {
      res.status(400).json({ error: 'item inválido' }); return;
    }
    const cleanItem = req.body.item.trim();
    update.item = cleanItem;
    update.emoji = getItemEmoji(cleanItem);
  }

  if (!Object.keys(update).length) {
    res.status(400).json({ error: 'nenhum campo válido para atualizar' }); return;
  }

  try {
    const collection = (await getDb()).collection<ShoppingItem>('shopping');
    const existing = await collection.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) { res.status(404).json({ error: 'item não encontrado' }); return; }

    if (update.quantidade !== undefined) {
      const parsedQty = parseQuantityNumber(update.quantidade, 1);
      if (isItemInCarrinho(existing)) {
        update.quantidadeNoCarrinho = parsedQty;
      } else {
        update.quantidadeEmCasa = parsedQty;
      }
    }

    const updated = await collection.findOneAndUpdate(
      { _id: existing._id },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!updated) { res.status(404).json({ error: 'item não encontrado' }); return; }
    notifyAndroid('RELOAD_SHOPPING');
    res.json({
      ...updated,
      _id: String(updated._id),
      quantidade: updated.quantidade || '1',
      quantidadeEmCasa: getQuantidadeEmCasa(updated),
      quantidadeNoCarrinho: getQuantidadeNoCarrinho(updated),
    });
  } catch (error) { next(error); }
});

r.delete('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'id inválido' }); return; }
  const contexto = req.query.contexto;
  try {
    const collection = (await getDb()).collection<ShoppingItem>('shopping');
    const id = new ObjectId(req.params.id);
    const existing = await collection.findOne({ _id: id });
    if (!existing) { res.status(404).json({ error: 'item não encontrado' }); return; }

    if (contexto === 'carrinho' && isItemInDispensa(existing)) {
      const emCasa = getQuantidadeEmCasa(existing);
      await collection.updateOne(
        { _id: id },
        { $set: { quantidadeNoCarrinho: 0, status: 'dispensa', quantidade: String(emCasa) } }
      );
      notifyAndroid('RELOAD_SHOPPING');
      res.status(204).end();
      return;
    }

    if (contexto === 'dispensa' && isItemInCarrinho(existing)) {
      const noCarrinho = getQuantidadeNoCarrinho(existing);
      await collection.updateOne(
        { _id: id },
        { $set: { quantidadeEmCasa: 0, naDispensa: false, status: 'carrinho', quantidade: String(noCarrinho || 1) } }
      );
      notifyAndroid('RELOAD_SHOPPING');
      res.status(204).end();
      return;
    }

    const result = await collection.deleteOne({ _id: id });
    if (!result.deletedCount) { res.status(404).json({ error: 'item não encontrado' }); return; }
    notifyAndroid('RELOAD_SHOPPING');
    res.status(204).end();
  } catch (error) { next(error); }
});

export default r;
