import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import { notifyAndroid } from '../lib/realtime';
import { addShoppingItem, ShoppingItem, ShoppingNormalizationError } from '../lib/shopping';

const r = Router();

r.post('/add', async (req, res, next) => {
  const input = req.body?.item;
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 200) {
    res.status(400).json({ error: 'item inválido' });
    return;
  }

  try {
    const item = await addShoppingItem(input.trim());
    res.status(201).json({ ...item, _id: String(item._id) });
  } catch (error) {
    if (error instanceof ShoppingNormalizationError) {
      res.status(502).json({ error: 'ai_unavailable' });
      return;
    }
    next(error);
  }
});

r.get('/list', async (_req, res, next) => {
  try {
    const items = await (await getDb())
      .collection<ShoppingItem>('shopping_list')
      .find()
      .sort({ comprado: 1, criadoEm: -1 })
      .toArray();
    res.json(items.map((item) => ({ ...item, _id: String(item._id) })));
  } catch (error) {
    next(error);
  }
});

r.patch('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id) || typeof req.body?.comprado !== 'boolean') {
    res.status(400).json({ error: 'id ou status inválido' });
    return;
  }

  try {
    const _id = new ObjectId(req.params.id);
    const collection = (await getDb()).collection<ShoppingItem>('shopping_list');
    const result = await collection.findOneAndUpdate(
      { _id },
      { $set: { comprado: req.body.comprado } },
      { returnDocument: 'after' }
    );
    if (!result) {
      res.status(404).json({ error: 'item não encontrado' });
      return;
    }
    notifyAndroid('RELOAD_SHOPPING');
    res.json({ ...result, _id: String(result._id) });
  } catch (error) {
    next(error);
  }
});

r.delete('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }

  try {
    const result = await (await getDb())
      .collection<ShoppingItem>('shopping_list')
      .deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) {
      res.status(404).json({ error: 'item não encontrado' });
      return;
    }
    notifyAndroid('RELOAD_SHOPPING');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default r;
