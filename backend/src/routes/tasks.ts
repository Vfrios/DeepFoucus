import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import { gerarTarefasIA } from '../lib/ai';
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  syncLinkedTaskEventsFromGoogle,
} from '../lib/google';
import { notify } from './push';

const r = Router();
const col = async () => (await getDb()).collection<any>('tasks');
const activityCol = async () => (await getDb()).collection<any>('activity');

const TIPOS = ['tarefa', 'evento', 'estudo'] as const;
type Tipo = (typeof TIPOS)[number];
const tipoValido = (v: unknown): v is Tipo =>
  typeof v === 'string' && (TIPOS as readonly string[]).includes(v);
const corValida = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const corPadrao = (tipo: Tipo) =>
  tipo === 'estudo' ? '#f0b95a' : tipo === 'evento' ? '#9db4ff' : '#86d7c0';

function validarCamposItem(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body inválido';
  if (body.titulo !== undefined && typeof body.titulo !== 'string') return 'titulo inválido';
  if (body.texto !== undefined && typeof body.texto !== 'string') return 'texto inválido';
  if (body.descricao !== undefined && typeof body.descricao !== 'string') return 'descricao inválida';
  if (body.tipo !== undefined && !tipoValido(body.tipo)) return 'tipo inválido';
  if (body.cor !== undefined && !corValida(body.cor)) return 'cor inválida';
  if (body.corPersonalizada !== undefined && typeof body.corPersonalizada !== 'boolean') {
    return 'corPersonalizada inválida';
  }
  if (
    body.calendarId !== undefined &&
    (typeof body.calendarId !== 'string' || !body.calendarId.trim() || body.calendarId.length > 255)
  ) {
    return 'calendarId inválido';
  }
  if (body.feito !== undefined && typeof body.feito !== 'boolean') return 'feito inválido';
  if (body.ordem !== undefined && (typeof body.ordem !== 'number' || !Number.isFinite(body.ordem))) {
    return 'ordem inválida';
  }

  for (const field of ['inicio', 'data', 'fim'] as const) {
    const value = body[field];
    if (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      (typeof value !== 'string' || isNaN(new Date(value).getTime()))
    ) {
      return `${field} inválido`;
    }
  }
  return null;
}

const toApi = (t: any) => {
  const tipo = tipoValido(t.tipo) ? t.tipo : 'tarefa';
  return {
    _id: String(t._id),
    // Campos novos
    titulo: t.titulo ?? t.texto ?? '',
    descricao: t.descricao ?? '',
    tipo,
    cor: corValida(t.cor) ? t.cor.toLowerCase() : corPadrao(tipo),
    corPersonalizada:
      typeof t.corPersonalizada === 'boolean'
        ? t.corPersonalizada
        : corValida(t.cor) && t.cor.toLowerCase() !== corPadrao(tipo),
    inicio: t.inicio ?? t.data ?? null,
    fim: t.fim ?? null,
    // Campos legados (compatibilidade com UI não migrada)
    texto: t.texto ?? t.titulo ?? '',
    data: t.data ?? t.inicio ?? null,
    // Comuns
    feito: !!t.feito,
    ordem: typeof t.ordem === 'number' ? t.ordem : 0,
    googleEventId: t.googleEventId ?? null,
    calendarId: t.calendarId ?? 'primary',
    criadoEm: t.criadoEm,
    atualizadoEm: t.atualizadoEm,
  };
};

const oid = (s: string) => (ObjectId.isValid(s) ? new ObjectId(s) : null);

const todayKey = () => {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
};

async function registrarAtividadeConcluida() {
  const dia = todayKey();
  const c = await activityCol();
  await c.updateOne({ _id: dia }, { $inc: { concluidas: 1 } }, { upsert: true });
}

/** Normaliza entrada (aceita tanto o formato novo quanto o legado). */
function lerCamposItem(body: any): Partial<{
  titulo: string;
  descricao: string;
  tipo: Tipo;
  cor: string;
  corPersonalizada: boolean;
  inicio: string | null;
  fim: string | null;
  texto: string;
  data: string | null;
  feito: boolean;
  ordem: number;
  calendarId: string;
  atualizadoEm: Date;
}> {
  const out: any = {};
  if (typeof body?.titulo === 'string') out.titulo = body.titulo.trim().slice(0, 200);
  else if (typeof body?.texto === 'string') out.titulo = body.texto.trim().slice(0, 200);

  if (typeof body?.descricao === 'string') out.descricao = body.descricao.trim().slice(0, 1000);
  if (tipoValido(body?.tipo)) out.tipo = body.tipo;
  if (corValida(body?.cor)) out.cor = body.cor.toLowerCase();
  if (typeof body?.corPersonalizada === 'boolean') out.corPersonalizada = body.corPersonalizada;

  const inicio = body?.inicio !== undefined ? body.inicio : body?.data;
  if (inicio === null || inicio === '') {
    out.inicio = null;
  } else if (typeof inicio === 'string' && !isNaN(new Date(inicio).getTime())) {
    out.inicio = new Date(inicio).toISOString();
  }
  if (body?.fim === null || body?.fim === '') {
    out.fim = null;
  } else if (typeof body?.fim === 'string' && !isNaN(new Date(body.fim).getTime())) {
    out.fim = new Date(body.fim).toISOString();
  }
  if (typeof body?.feito === 'boolean') out.feito = body.feito;
  if (typeof body?.ordem === 'number') out.ordem = body.ordem;
  if (typeof body?.calendarId === 'string') out.calendarId = body.calendarId.trim();

  // Espelhos legados: mantemos para o frontend não migrado continuar funcionando
  if (out.titulo !== undefined) out.texto = out.titulo;
  if (out.inicio !== undefined) out.data = out.inicio;

  return out;
}

// ---- CRUD ----

r.get('/', async (_req, res) => {
  // Do not make task loading wait for the external Calendar API.
  void syncLinkedTaskEventsFromGoogle().catch((e) =>
    console.warn('[tasks] falha ao sincronizar alterações do Google Calendar:', e)
  );
  const list = await (await col()).find().sort({ ordem: 1, criadoEm: 1 }).toArray();
  res.json(list.map(toApi));
});

r.post('/', async (req, res) => {
  const erro = validarCamposItem(req.body);
  if (erro) {
    res.status(400).json({ error: erro });
    return;
  }
  const campos = lerCamposItem(req.body);
  if (!campos.titulo) {
    res.status(400).json({ error: 'titulo obrigatório' });
    return;
  }
  if (campos.inicio && campos.fim && new Date(campos.fim) <= new Date(campos.inicio)) {
    res.status(400).json({ error: 'fim deve ser posterior ao início' });
    return;
  }

  const c = await col();
  const last = await c.find().sort({ ordem: -1 }).limit(1).toArray();
  const now = new Date();
  const doc: any = {
    titulo: campos.titulo,
    texto: campos.titulo, // espelho legado
    descricao: campos.descricao ?? '',
    tipo: campos.tipo ?? 'tarefa',
    cor: campos.cor ?? corPadrao(campos.tipo ?? 'tarefa'),
    corPersonalizada:
      campos.corPersonalizada ??
      (campos.cor !== undefined && campos.cor.toLowerCase() !== corPadrao(campos.tipo ?? 'tarefa')),
    inicio: campos.inicio ?? null,
    data: campos.inicio ?? null, // espelho legado
    fim: campos.fim ?? null,
    calendarId: campos.calendarId ?? 'primary',
    feito: false,
    ordem: (last[0]?.ordem ?? -1) + 1,
    criadoEm: now,
    atualizadoEm: now,
  };
  const ins = await c.insertOne(doc);
  doc._id = ins.insertedId;

  // Sync Google: cria evento se tiver início
  if (doc.inicio) {
    const eventId = await createCalendarEvent({
      titulo: doc.titulo,
      descricao: doc.descricao,
      inicio: doc.inicio,
      fim: doc.fim,
      feito: doc.feito,
      calendarId: doc.calendarId,
    });
    if (eventId) {
      await c.updateOne({ _id: ins.insertedId }, { $set: { googleEventId: eventId } });
      doc.googleEventId = eventId;
    }
  }

  notify('Novo item', doc.titulo);
  res.status(201).json(toApi(doc));
});

// ---- IA: gerar itens a partir de um roteiro ----
r.post('/from-roteiro', async (req, res) => {
  const erro = validarCamposItem(req.body);
  if (erro && req.body?.calendarId !== undefined) {
    res.status(400).json({ error: erro });
    return;
  }
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

  if (req.body?.preview === true) {
    res.json({ ok: true, tarefas: geradas });
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
    titulo: t.titulo,
    texto: t.titulo,
    descricao: t.descricao,
    tipo: t.tipo,
    cor: corPadrao(t.tipo),
    inicio: t.inicio,
    data: t.inicio,
    fim: t.fim,
    calendarId: typeof req.body?.calendarId === 'string' ? req.body.calendarId.trim() : 'primary',
    feito: false,
    ordem: ordemBase++,
    criadoEm: now,
    atualizadoEm: now,
  }));

  const ins = await c.insertMany(docs);
  const ids = Object.values(ins.insertedIds);

  await Promise.all(
    ids.map(async (id, i) => {
      if (!docs[i].inicio) {
        docs[i]._id = id;
        return;
      }
      const evId = await createCalendarEvent({
        titulo: docs[i].titulo,
        descricao: docs[i].descricao,
        inicio: docs[i].inicio,
        fim: docs[i].fim,
        feito: docs[i].feito,
        calendarId: docs[i].calendarId,
      });
      if (evId) {
        docs[i].googleEventId = evId;
        await c.updateOne({ _id: id }, { $set: { googleEventId: evId } });
      }
      docs[i]._id = id;
    })
  );

  const inseridas = docs.map(toApi);
  notify('Itens gerados por IA', `${inseridas.length} novo(s) item(ns)`);
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
  const erro = validarCamposItem(req.body);
  if (erro) {
    res.status(400).json({ error: erro });
    return;
  }
  const set = lerCamposItem(req.body);
  if ((set.titulo !== undefined && !set.titulo) || (set.texto !== undefined && !set.texto)) {
    res.status(400).json({ error: 'titulo obrigatório' });
    return;
  }
  set.atualizadoEm = new Date();

  const c = await col();
  const before = await c.findOne({ _id });
  if (!before) {
    res.status(404).json({ error: 'não encontrada' });
    return;
  }
  const merged = { ...before, ...set };
  if (set.cor !== undefined && set.corPersonalizada === undefined) {
    set.corPersonalizada = set.cor.toLowerCase() !== corPadrao(set.tipo ?? before.tipo ?? 'tarefa');
    merged.corPersonalizada = set.corPersonalizada;
  }
  if (merged.inicio && merged.fim && new Date(merged.fim) <= new Date(merged.inicio)) {
    res.status(400).json({ error: 'fim deve ser posterior ao início' });
    return;
  }
  await c.updateOne({ _id }, { $set: set });

  // Atividade ao concluir (transição false → true)
  if (set.feito === true && !before.feito) {
    await registrarAtividadeConcluida();
    notify('Item concluído', before.titulo || before.texto);
  }

  // Sync Google: se tem evento, atualiza; senão, cria um novo
  const previousCalendarId = before.calendarId || 'primary';
  const calendarId = merged.calendarId || previousCalendarId;
  if (merged.googleEventId) {
    if (!merged.inicio && !merged.data) {
      await deleteCalendarEvent(merged.googleEventId, previousCalendarId);
      await c.updateOne({ _id }, { $unset: { googleEventId: '' } });
      delete merged.googleEventId;
    } else if (calendarId !== previousCalendarId) {
      await deleteCalendarEvent(merged.googleEventId, previousCalendarId);
      const evId = await createCalendarEvent({
        titulo: merged.titulo || merged.texto || '',
        descricao: merged.descricao,
        inicio: merged.inicio || merged.data,
        fim: merged.fim,
        feito: merged.feito,
        calendarId,
      });
      if (evId) {
        await c.updateOne({ _id }, { $set: { googleEventId: evId } });
        merged.googleEventId = evId;
      } else {
        await c.updateOne({ _id }, { $unset: { googleEventId: '' } });
        delete merged.googleEventId;
      }
    } else {
      await updateCalendarEvent(merged.googleEventId, {
        titulo: merged.titulo || merged.texto || '',
        descricao: merged.descricao,
        inicio: merged.inicio || merged.data,
        fim: merged.fim,
        feito: merged.feito,
      }, calendarId);
    }
  } else if (merged.inicio || merged.data) {
    const evId = await createCalendarEvent({
      titulo: merged.titulo || merged.texto || '',
      descricao: merged.descricao,
      inicio: merged.inicio || merged.data,
      fim: merged.fim,
      feito: merged.feito,
      calendarId,
    });
    if (evId) {
      await c.updateOne({ _id }, { $set: { googleEventId: evId } });
      merged.googleEventId = evId;
    }
  }

  res.json(toApi(merged));
});

r.delete('/:id', async (req, res) => {
  const _id = oid(req.params.id);
  if (!_id) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }
  const c = await col();
  const before = await c.findOne({ _id });
  if (!before) {
    res.status(204).end();
    return;
  }
  if (before.googleEventId) {
    await deleteCalendarEvent(before.googleEventId, before.calendarId || 'primary');
  }
  await c.deleteOne({ _id });
  res.status(204).end();
});

// ---- IA: PREVIEW (não persiste) ----
// Usado pela Fase 3: o frontend mostra um modal de revisão antes de gravar.
// Body:
//   { roteiro: string }                     → modo "gerar"
//   { modo: 'sugestao', descricao: string } → modo "sugestao" (sugere título/tipo)
r.post('/preview-roteiro', async (req, res) => {
  const modo = req.body?.modo === 'sugestao' ? 'sugestao' : 'gerar';

  if (modo === 'sugestao') {
    const descricao = String(req.body?.descricao || '').trim();
    if (!descricao) {
      res.status(400).json({ error: 'descricao obrigatória' });
      return;
    }
    try {
      // Reutilizamos o motor de tarefas: pedimos 1 item a partir da descrição
      const itens = await gerarTarefasIA(descricao);
      // Se a IA não achou nada, devolvemos a própria descrição como título
      const sugerido = itens[0] ?? {
        titulo: descricao.slice(0, 200),
        tipo: 'tarefa' as const,
        descricao,
        inicio: new Date().toISOString(),
        fim: null,
      };
      res.json({
        ok: true,
        sugestao: {
          titulo: sugerido.titulo,
          tipo: sugerido.tipo,
          descricao: sugerido.descricao || descricao,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: 'falha_ia', detalhe: e?.message || 'erro' });
    }
    return;
  }

  // modo "gerar": só gera, não insere
  const roteiro = String(req.body?.roteiro || '').trim();
  if (!roteiro) {
    res.status(400).json({ error: 'roteiro obrigatório' });
    return;
  }
  try {
    const itens = await gerarTarefasIA(roteiro);
    res.json({ ok: true, tarefas: itens });
  } catch (e: any) {
    res.status(500).json({ error: 'falha_ia', detalhe: e?.message || 'erro' });
  }
});

export default r;
