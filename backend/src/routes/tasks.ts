import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import { gerarTarefasIA } from '../lib/ai';
import { createCalendarEvent, markCalendarEventDone } from '../lib/google';
import { notify } from './push';

const r = Router();
const col = async () => (await getDb()).collection<any>('tasks');
const activityCol = async () => (await getDb()).collection<any>('activity');

const toApi = (t: any) => ({
  _id: String(t._id),
  texto: t.texto,
  feito: t.feito,
  ordem: t.ordem,
  data: t.data ?? null,
  googleEventId: t.googleEventId ?? null,
  criadoEm: t.criadoEm,
  atualizadoEm: t.atualizadoEm,
});

const oid = (s: string) => (ObjectId.isValid(s) ? new ObjectId(s) : null);

/** Chave do dia em horário de Brasília (UTC-3). */
const todayKey = () => {
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d.toISOString().slice(0, 10);
};

/**
 * FASE 2: upsert em `activity` do dia.
 * `inc` com defaults garante criação correta mesmo se o doc não existir.
 */
async function registrarAtividade(opts: {
  concluidas?: number;
  minutos?: number;
  tags?: Record<string, number>;
}) {
  const dia = todayKey();
  const c = await activityCol();
  const inc: Record<string, number> = {};
  if (opts.concluidas) inc.concluidas = opts.concluidas;
  if (opts.minutos) inc.minutosEstudo = opts.minutos;
  // tags são incrementadas individualmente
  const incOps: any = {};
  if (Object.keys(inc).length) incOps.$inc = inc;
  if (opts.tags) {
    for (const [k, v] of Object.entries(opts.tags)) {
      incOps.$inc = incOps.$inc || {};
      incOps.$inc[`tags.${k}`] = v;
    }
  }
  // Garante que concluidas/minutosEstudo existam ao criar o doc
  const setOnInsert = { concluidas: 0, minutosEstudo: 0, tags: {} };
  await c.updateOne(
    { _id: dia },
    { ...incOps, $setOnInsert: setOnInsert },
    { upsert: true }
  );
}

// ---- CRUD ----
r.get('/', async (_req, res) => {
  const list = await (await col()).find().sort({ ordem: 1, criadoEm: 1 }).toArray();
  res.json(list.map(toApi));
});

r.post('/', async (req, res) => {
  const texto = String(req.body?.texto || '').trim().slice(0, 200);
  if (!texto) {
    res.status(400).json({ error: 'texto obrigatório' });
    return;
  }
  const c = await col();
  const last = await c.find().sort({ ordem: -1 }).limit(1).toArray();
  const now = new Date();
  const doc: any = {
    texto,
    feito: false,
    ordem: (last[0]?.ordem ?? -1) + 1,
    data: typeof req.body?.data === 'string' ? req.body.data : null,
    criadoEm: now,
    atualizadoEm: now,
  };
  const ins = await c.insertOne(doc);
  doc._id = ins.insertedId;

  // FASE 4: cria evento no Google, mas NÃO bloqueia nem falha se der erro.
  const eventId = await createCalendarEvent({ texto: doc.texto, data: doc.data });
  if (eventId) {
    await c.updateOne({ _id: ins.insertedId }, { $set: { googleEventId: eventId } });
    doc.googleEventId = eventId;
  }

  notify('Nova tarefa', texto);
  res.status(201).json(toApi(doc));
});

// ---- IA: gerar tarefas a partir de um roteiro ----
r.post('/from-roteiro', async (req, res) => {
  const roteiro = String(req.body?.roteiro || '').trim();
  if (!roteiro) {
    res.status(400).json({ error: 'roteiro obrigatório' });
    return;
  }

  let geradas;
  try {
    geradas = await gerarTarefasIA(roteiro);
  } catch (e: any) {
    res.status(500).json({ error: 'falha_ia', detalhe: e?.message || 'erro desconhecido' });
    return;
  }

  if (geradas.length === 0) {
    res.status(201).json({ ok: true, inseridas: 0, tarefas: [] });
    return;
  }

  const c = await col();
  const last = await c.find().sort({ ordem: -1 }).limit(1).toArray();
  let ordemBase = (last[0]?.ordem ?? -1) + 1;

  const now = new Date();
  const docs: any[] = geradas.map((t) => ({
    texto: t.texto,
    data: t.data,
    feito: false,
    ordem: ordemBase++,
    criadoEm: now,
    atualizadoEm: now,
  }));

  const ins = await c.insertMany(docs);
  const ids = Object.values(ins.insertedIds);

  // FASE 4: cria eventos no Google em paralelo, sem bloquear a resposta.
  // Falhas individuais são ignoradas (createCalendarEvent já faz try/catch).
  await Promise.all(
    ids.map(async (id, i) => {
      const evId = await createCalendarEvent({ texto: docs[i].texto, data: docs[i].data });
      if (evId) {
        docs[i].googleEventId = evId;
        await c.updateOne({ _id: id }, { $set: { googleEventId: evId } });
      }
      docs[i]._id = id;
    })
  );

  const inseridas = docs.map(toApi);
  notify('Tarefas geradas por IA', `${inseridas.length} nova(s) tarefa(s)`);
  res.status(201).json({ ok: true, inseridas: inseridas.length, tarefas: inseridas });
});

// Reordenar (antes de "/:id")
r.post('/reorder', async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const c = await col();
  const ops = ids.flatMap((id, i) => {
    const _id = oid(id);
    return _id ? [{ updateOne: { filter: { _id }, update: { $set: { ordem: i } } } }] : [];
  });
  if (ops.length) await c.bulkWrite(ops);
  res.json({ ok: true });
});

r.patch('/:id', async (req, res) => {
  const _id = oid(req.params.id);
  if (!_id) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }
  const set: any = { atualizadoEm: new Date() };
  if (typeof req.body?.texto === 'string') set.texto = req.body.texto.trim().slice(0, 200);
  if (typeof req.body?.feito === 'boolean') set.feito = req.body.feito;
  if (typeof req.body?.ordem === 'number') set.ordem = req.body.ordem;
  if (typeof req.body?.data === 'string') set.data = req.body.data;

  const c = await col();
  const before = await c.findOne({ _id });
  if (!before) {
    res.status(404).json({ error: 'não encontrada' });
    return;
  }
  await c.updateOne({ _id }, { $set: set });

  // FASE 2: ao concluir (transição false -> true), registra atividade do dia.
  if (set.feito === true && !before.feito) {
    await registrarAtividade({ concluidas: 1 });
    notify('Tarefa concluída', before.texto);
  }

  // FASE 4: se tem evento no Google, sincroniza o título. Falha silenciosa.
  if (before.googleEventId && typeof set.feito === 'boolean') {
    await markCalendarEventDone(
      before.googleEventId,
      set.feito,
      set.texto ?? before.texto
    );
  }

  res.json(toApi({ ...before, ...set }));
});

r.delete('/:id', async (req, res) => {
  const _id = oid(req.params.id);
  if (!_id) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }
  await (await col()).deleteOne({ _id });
  res.status(204).end();
});

// ---- FASE 3: incremento manual de minutos (usado pelo Pomodoro) ----
r.post('/increment', async (req, res) => {
  const minutos = Math.max(0, Math.min(600, Number(req.body?.minutos) || 0));
  if (!minutos) {
    res.status(400).json({ error: 'minutos obrigatório' });
    return;
  }
  await registrarAtividade({ minutos });
  res.status(201).json({ ok: true, minutos });
});

export default r;
