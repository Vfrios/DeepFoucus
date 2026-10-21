import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import { sumarizarNotas } from '../lib/ai';

const r = Router();
const col = async () => (await getDb()).collection<any>('notes');

const CORES = ['#86d7c0', '#f0b95a', '#e67c73', '#9db4ff', '#c8a2f0', '#a8e6a3'] as const;
const corValida = (v: unknown): v is string =>
  typeof v === 'string' && CORES.includes(v as any);

const oid = (s: string) => (ObjectId.isValid(s) ? new ObjectId(s) : null);

const toApi = (n: any) => ({
  _id: String(n._id),
  titulo: n.titulo ?? '',
  conteudo: n.conteudo ?? '',
  cor: n.cor ?? CORES[0],
  criadoEm: n.criadoEm,
  atualizadoEm: n.atualizadoEm ?? n.criadoEm,
});

r.get('/', async (_req, res) => {
  const list = await (await col()).find().sort({ criadoEm: -1 }).toArray();
  res.json(list.map(toApi));
});

r.post('/', async (req, res) => {
  const titulo = String(req.body?.titulo || '').trim().slice(0, 120);
  const conteudo = String(req.body?.conteudo || '').trim().slice(0, 5000);
  if (!titulo && !conteudo) {
    res.status(400).json({ error: 'titulo ou conteudo obrigatório' });
    return;
  }
  const now = new Date();
  const doc: any = {
    titulo: titulo || '(sem título)',
    conteudo,
    cor: corValida(req.body?.cor) ? req.body.cor : CORES[0],
    criadoEm: now,
    atualizadoEm: now,
  };
  const c = await col();
  const r2 = await c.insertOne(doc);
  doc._id = r2.insertedId;
  res.status(201).json(toApi(doc));
});

r.patch('/:id', async (req, res) => {
  const _id = oid(req.params.id);
  if (!_id) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }
  const set: any = { atualizadoEm: new Date() };
  if (typeof req.body?.titulo === 'string') set.titulo = req.body.titulo.trim().slice(0, 120);
  if (typeof req.body?.conteudo === 'string') set.conteudo = req.body.conteudo.trim().slice(0, 5000);
  if (corValida(req.body?.cor)) set.cor = req.body.cor;

  const c = await col();
  const before = await c.findOne({ _id });
  if (!before) {
    res.status(404).json({ error: 'não encontrada' });
    return;
  }
  await c.updateOne({ _id }, { $set: set });
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

// ---- FASE 5: sumarização por IA ----
r.post('/summarize', async (_req, res) => {
  try {
    const c = await col();
    const docs = await c.find().sort({ criadoEm: -1 }).limit(50).toArray();
    if (docs.length === 0) {
      res.json({ ok: true, resumo: '', tarefas: [] });
      return;
    }

    const notas = docs.map((d: any) => ({
      titulo: String(d.titulo || ''),
      conteudo: String(d.conteudo || ''),
    }));

    const { resumo, tarefas } = await sumarizarNotas(notas);
    res.json({ ok: true, resumo, tarefas });
  } catch (e: any) {
    console.error('[notes/summarize] erro:', e?.message || e);
    res.status(500).json({ error: 'falha_ia', detalhe: e?.message || 'erro' });
  }
});

export default r;
