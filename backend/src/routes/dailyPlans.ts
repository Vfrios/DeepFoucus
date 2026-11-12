import { Request, Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';

const r = Router();
const TIME_ZONE = 'America/Sao_Paulo';

function email(req: Request) {
  return req.user?.email || process.env.HEALTH_API_EMAIL || process.env.EMAIL_VITOR || 'owner@local';
}

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(new Date());
}

function normalizePriority(value: unknown) {
  const allowed = ['urgente_hoje', 'medio_2dias', 'distante_3dias', 'futuro'];
  return typeof value === 'string' && allowed.includes(value) ? value : 'futuro';
}

export function normalizeItems(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 100).map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const texto = String(item.texto ?? item.titulo ?? '').trim().slice(0, 500);
    return {
      _id: ObjectId.isValid(String(item._id || '')) ? new ObjectId(String(item._id)) : new ObjectId(),
      texto,
      prioridade: normalizePriority(item.prioridade),
      feito: item.feito === true,
      ordem: index + 1,
    };
  }).filter((item) => item.texto);
}

export function removeDailyPlanItem<T extends { _id: ObjectId }>(items: T[], itemId: ObjectId): T[] {
  return items.filter((item) => !item._id.equals(itemId));
}

const serialize = (plan: any) => plan && ({
  ...plan,
  _id: String(plan._id),
  itens: (plan.itens || []).map((item: any) => ({ ...item, _id: String(item._id) })),
});

r.get('/', async (req, res, next) => {
  try {
    const plan = await (await getDb()).collection('daily_plans').findOne({ email: email(req), data: today() });
    res.json(serialize(plan));
  } catch (error) { next(error); }
});

r.post('/', async (req, res, next) => {
  const itens = normalizeItems(req.body?.itens);
  if (!itens?.length) {
    res.status(400).json({ error: 'itens obrigatórios' });
    return;
  }
  try {
    const now = new Date();
    const collection = (await getDb()).collection('daily_plans');
    const plan = await collection.findOneAndUpdate(
      { email: email(req), data: today() },
      { $set: { itens, atualizadoEm: now }, $setOnInsert: { criadoEm: now } },
      { upsert: true, returnDocument: 'after' }
    );
    res.status(201).json(serialize(plan));
  } catch (error) { next(error); }
});

r.patch('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id) || !ObjectId.isValid(String(req.body?.itemId || ''))) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }
  const set: Record<string, unknown> = { atualizadoEm: new Date() };
  if (req.body.texto !== undefined) {
    const texto = typeof req.body.texto === 'string' ? req.body.texto.trim().slice(0, 500) : '';
    if (!texto) { res.status(400).json({ error: 'texto inválido' }); return; }
    set['itens.$.texto'] = texto;
  }
  if (req.body.prioridade !== undefined) set['itens.$.prioridade'] = normalizePriority(req.body.prioridade);
  if (req.body.feito !== undefined) {
    if (typeof req.body.feito !== 'boolean') { res.status(400).json({ error: 'feito inválido' }); return; }
    set['itens.$.feito'] = req.body.feito;
  }
  try {
    const plan = await (await getDb()).collection('daily_plans').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), email: email(req), 'itens._id': new ObjectId(req.body.itemId) },
      { $set: set },
      { returnDocument: 'after' }
    );
    if (!plan) { res.status(404).json({ error: 'item não encontrado' }); return; }
    res.json(serialize(plan));
  } catch (error) { next(error); }
});

r.delete('/:id', async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id) || !ObjectId.isValid(String(req.body?.itemId || req.query.itemId || ''))) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }
  try {
    const itemId = new ObjectId(String(req.body?.itemId || req.query.itemId));
    const plan = await (await getDb()).collection('daily_plans').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), email: email(req) },
      { $pull: { itens: { _id: itemId } } as any, $set: { atualizadoEm: new Date() } },
      { returnDocument: 'after' }
    );
    if (!plan) { res.status(404).json({ error: 'plano não encontrado' }); return; }
    res.json(serialize(plan));
  } catch (error) { next(error); }
});

export default r;
