import { Request, Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongo';
import {
  classificarPrioridadePorData,
  CorPrioridade,
  corPrioridadeValida,
  gerarPreviewAgendaIA,
  gerarTarefasIA,
  PRIORIDADE_COLOR_ID,
  PRIORIDADE_HEX,
} from '../lib/ai';
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listEvents,
  syncLinkedTaskEventsFromGoogle,
  getGoogleColorIdForPriority,
} from '../lib/google';
import { notify } from './push';

const r = Router();
const col = async () => (await getDb()).collection<any>('tasks');
const activityCol = async () => (await getDb()).collection<any>('activity');
const profileCol = async () => (await getDb()).collection<any>('profile');

const TIPOS = ['tarefa', 'evento', 'estudo', 'treino'] as const;
type Tipo = (typeof TIPOS)[number];
const tipoValido = (v: unknown): v is Tipo =>
  typeof v === 'string' && (TIPOS as readonly string[]).includes(v);
const corValida = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const corPadrao = (tipo: Tipo) =>
  tipo === 'estudo' ? '#f0b95a' : tipo === 'evento' ? '#9db4ff' : tipo === 'treino' ? '#c084fc' : '#86d7c0';

function resolverEmailUsuario(req: Request): string {
  return (
    req.user?.email ||
    process.env.HEALTH_API_EMAIL ||
    process.env.EMAIL_VITOR ||
    'owner@local'
  );
}

function validarCamposItem(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body inválido';
  if (body.titulo !== undefined && typeof body.titulo !== 'string') return 'titulo inválido';
  if (body.texto !== undefined && typeof body.texto !== 'string') return 'texto inválido';
  if (body.descricao !== undefined && typeof body.descricao !== 'string') return 'descricao inválida';
  if (body.tipo !== undefined && !tipoValido(body.tipo)) return 'tipo inválido';
  if (body.cor !== undefined && !corValida(body.cor)) return 'cor inválida';
  if (
    body.corPrioridade !== undefined &&
    body.corPrioridade !== null &&
    !corPrioridadeValida(body.corPrioridade)
  ) {
    return 'corPrioridade inválida';
  }
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
  const corPrioridade: CorPrioridade | null = corPrioridadeValida(t.corPrioridade)
    ? t.corPrioridade
    : null;
  const corHex = corValida(t.cor)
    ? t.cor.toLowerCase()
    : corPrioridade
      ? PRIORIDADE_HEX[corPrioridade]
      : corPadrao(tipo);
  return {
    _id: String(t._id),
    // Campos novos
    titulo: t.titulo ?? t.texto ?? '',
    descricao: t.descricao ?? '',
    tipo,
    cor: corHex,
    corPrioridade,
    colorId: corPrioridade ? PRIORIDADE_COLOR_ID[corPrioridade] : undefined,
    corPersonalizada:
      typeof t.corPersonalizada === 'boolean'
        ? t.corPersonalizada
        : Boolean(corPrioridade) || (corValida(t.cor) && t.cor.toLowerCase() !== corPadrao(tipo)),
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
  corPrioridade: CorPrioridade | null;
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
  const prioInput = body?.corPrioridade;
  if (corPrioridadeValida(prioInput)) {
    out.corPrioridade = prioInput;
    if (!corValida(body?.cor)) {
      out.cor = PRIORIDADE_HEX[prioInput];
      out.corPersonalizada = true;
    }
  } else if (prioInput === null) {
    out.corPrioridade = null;
  }
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
  const corPrioridade: CorPrioridade | null =
    campos.corPrioridade !== undefined
      ? campos.corPrioridade
      : campos.inicio
        ? classificarPrioridadePorData(campos.inicio, undefined, now)
        : null;
  const corFinal =
    campos.cor ??
    (corPrioridade ? PRIORIDADE_HEX[corPrioridade] : corPadrao(campos.tipo ?? 'tarefa'));

  const doc: any = {
    titulo: campos.titulo,
    texto: campos.titulo, // espelho legado
    descricao: campos.descricao ?? '',
    tipo: campos.tipo ?? 'tarefa',
    cor: corFinal,
    corPrioridade,
    corPersonalizada:
      campos.corPersonalizada ??
      (Boolean(corPrioridade) ||
        (campos.cor !== undefined &&
          campos.cor.toLowerCase() !== corPadrao(campos.tipo ?? 'tarefa'))),
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
    colorId: getGoogleColorIdForPriority(doc.corPrioridade),
  });
  if (eventId) {
    await c.updateOne({ _id: ins.insertedId }, { $set: { googleEventId: eventId } });
    doc.googleEventId = eventId;
  }
}

notify('Novo item', doc.titulo);
res.status(201).json(toApi(doc));
});

// ---- IA: PREVIEW INTELIGENTE (O Fim do Café da Manhã + Prioridade GitHub) ----
r.post('/preview-ai', async (req, res) => {
  const texto = String(
    req.body?.texto ?? req.body?.roteiro ?? req.body?.prompt ?? ''
  ).trim();
  if (!texto) {
    res.status(400).json({ error: 'texto obrigatório' });
    return;
  }

  try {
    const db = await getDb();
    const email = resolverEmailUsuario(req);
    const now = new Date();

    const [profile, diets, tasksAtivas] = await Promise.all([
      db.collection('profile').findOne({ email }).then((p) => p || db.collection('profile').findOne({})),
      db.collection('diets').find({ email }).sort({ geradoEm: -1 }).limit(1).toArray(),
      db.collection('tasks').find({ feito: false, inicio: { $type: 'string' } }).limit(50).toArray(),
    ]);

    // Horário de fim do café da manhã (padrão 09:00; se a dieta tiver café da manhã mais tarde, respeita)
    let fimCafeManha = '09:00';
    const refeicoes = Array.isArray(diets[0]?.refeicoes) ? diets[0].refeicoes : [];
    const cafe = refeicoes.find((m: any) =>
      /caf[eé]|manh[aã]|desjejum/i.test(String(m?.nome || ''))
    );
    if (cafe && typeof cafe.horario === 'string' && /^\d{2}:\d{2}$/.test(cafe.horario)) {
      const [hh, mm] = cafe.horario.split(':').map(Number);
      const fimMin = Math.max(9 * 60, hh * 60 + mm + 30);
      fimCafeManha = `${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}`;
    }

    // Eventos existentes no Google Calendar + tarefas locais agendadas
    const eventosExistentes: Array<{ title?: string; start: string; end: string; allDay?: boolean }> = [];
    try {
      const googleEvents = await listEvents(now, 14);
      for (const ev of googleEvents) {
        eventosExistentes.push({
          title: ev.title,
          start: ev.start,
          end: ev.end,
          allDay: ev.allDay,
        });
      }
    } catch (err) {
      console.warn(
        '[tasks] preview-ai could not load Google Calendar events:',
        err instanceof Error ? err.message : String(err)
      );
    }

    for (const t of tasksAtivas) {
      if (!t.inicio) continue;
      const start = String(t.inicio);
      const end = t.fim
        ? String(t.fim)
        : new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
      eventosExistentes.push({
        title: String(t.titulo || t.texto || 'Tarefa'),
        start,
        end,
        allDay: false,
      });
    }

    const tarefas = await gerarPreviewAgendaIA(texto, {
      agora: now,
      fimCafeManha,
      eventosExistentes,
      perfil: profile
        ? {
          objetivo: profile.objetivo,
          disponibilidadePorDia: profile.disponibilidadePorDia,
          duracaoTreino: profile.duracaoTreino,
        }
        : null,
    });

    res.json({ ok: true, tarefas });
  } catch (e: any) {
    res.status(500).json({
      error: 'falha_ia',
      detalhe: e?.message || 'erro desconhecido',
    });
  }
});

// ---- IA: CONFIRMAR E AGENDAR (Salva no MongoDB com corPrioridade e envia ao Google Calendar) ----
r.post('/confirm', async (req, res) => {
  const rawList = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.tarefas)
      ? req.body.tarefas
      : Array.isArray(req.body?.itens)
        ? req.body.itens
        : null;

  if (!rawList) {
    res.status(400).json({ error: 'tarefas obrigatórias (array)' });
    return;
  }

  if (rawList.length === 0) {
    res.status(201).json({ ok: true, inseridas: 0, tarefas: [] });
    return;
  }

  const calendarIdPadrao =
    typeof req.body?.calendarId === 'string' && req.body.calendarId.trim()
      ? req.body.calendarId.trim()
      : 'primary';

  const now = new Date();
  const c = await col();
  const last = await c.find().sort({ ordem: -1 }).limit(1).toArray();
  let ordemBase = (last[0]?.ordem ?? -1) + 1;

  const docs: any[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const titulo = String(item.titulo ?? item.texto ?? '').trim().slice(0, 200);
    if (!titulo) continue;
    const descricao = typeof item.descricao === 'string' ? item.descricao.trim().slice(0, 1000) : '';
    const tipo: Tipo = tipoValido(item.tipo) ? item.tipo : 'tarefa';

    const inicioRaw = item.inicio ?? item.data ?? null;
    const inicio =
      typeof inicioRaw === 'string' && inicioRaw && !isNaN(new Date(inicioRaw).getTime())
        ? new Date(inicioRaw).toISOString()
        : null;

    let fim =
      typeof item.fim === 'string' && item.fim && !isNaN(new Date(item.fim).getTime())
        ? new Date(item.fim).toISOString()
        : null;
    if (inicio && (!fim || new Date(fim) <= new Date(inicio))) {
      fim = new Date(new Date(inicio).getTime() + 60 * 60 * 1000).toISOString();
    }

    const corPrioridade: CorPrioridade = classificarPrioridadePorData(
      inicio,
      item.corPrioridade,
      now
    );
    const corHex = PRIORIDADE_HEX[corPrioridade];
    const calendarId =
      typeof item.calendarId === 'string' && item.calendarId.trim()
        ? item.calendarId.trim()
        : calendarIdPadrao;

    docs.push({
      titulo,
      texto: titulo,
      descricao,
      tipo,
      cor: corHex,
      corPrioridade,
      corPersonalizada: true,
      inicio,
      data: inicio,
      fim,
      calendarId,
      feito: false,
      ordem: ordemBase++,
      criadoEm: now,
      atualizadoEm: now,
    });
  }

  if (docs.length === 0) {
    res.status(400).json({ error: 'nenhuma tarefa válida para confirmar' });
    return;
  }

  const ins = await c.insertMany(docs);
  const kanbanCandidates = docs.filter((doc) => !doc.inicio && (doc.corPrioridade === 'distante_3dias' || doc.corPrioridade === 'futuro'));
  if (kanbanCandidates.length) {
    const email = resolverEmailUsuario(req);
    const pCol = await profileCol();
    const profile = await pCol.findOne({ email });
    const goals = sanitizarKanbanGoals(profile?.kanban_goals) ?? [];
    for (const doc of kanbanCandidates) goals.push({ id: `agenda-${new ObjectId().toHexString()}`, titulo: doc.titulo, coluna: 'a_fazer', criadoEm: now.toISOString(), prioridade: doc.corPrioridade });
    await pCol.updateOne(profile?._id ? { _id: profile._id } : { email }, { $set: { kanban_goals: goals, atualizadoEm: now }, $setOnInsert: { email, criadoEm: now } }, { upsert: true });
  }
  const ids = Object.values(ins.insertedIds);

  await Promise.all(
    ids.map(async (id, i) => {
      docs[i]._id = id;
      if (!docs[i].inicio) return;
      const colorId = PRIORIDADE_COLOR_ID[docs[i].corPrioridade as CorPrioridade];
      const evId = await createCalendarEvent({
        titulo: docs[i].titulo,
        descricao: docs[i].descricao,
        inicio: docs[i].inicio,
        fim: docs[i].fim,
        feito: docs[i].feito,
        calendarId: docs[i].calendarId,
        colorId,
      });
      if (evId) {
        docs[i].googleEventId = evId;
        await c.updateOne({ _id: id }, { $set: { googleEventId: evId } });
      }
    })
  );

  const inseridas = docs.map(toApi);
  notify('Agenda confirmada', `${inseridas.length} tarefa(s) agendada(s)`);
  res.status(201).json({ ok: true, inseridas: inseridas.length, tarefas: inseridas });
});

// ---- Quadro de Metas (Kanban salvo no perfil em kanban_goals) ----
const KANBAN_COLS = ['a_fazer', 'em_andamento', 'concluido'] as const;
type KanbanCol = (typeof KANBAN_COLS)[number];

function normalizarColunaKanban(v: unknown): KanbanCol {
  if (v === 'em_andamento' || v === 'doing' || v === 'in_progress') return 'em_andamento';
  if (v === 'concluido' || v === 'done') return 'concluido';
  return 'a_fazer';
}

function sanitizarKanbanGoals(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, idx) => ({
      id:
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim().slice(0, 80)
          : `goal-${Date.now()}-${idx}`,
      titulo: String(item.titulo ?? item.title ?? item.texto ?? '')
        .trim()
        .slice(0, 200),
      coluna: normalizarColunaKanban(item.coluna ?? item.status ?? item.column),
      criadoEm:
        typeof item.criadoEm === 'string' ? item.criadoEm : new Date().toISOString(),
      ...(item.prioridade === 'urgente_hoje' || item.prioridade === 'medio_2dias' || item.prioridade === 'distante_3dias' || item.prioridade === 'futuro' ? { prioridade: item.prioridade } : {}),
    }))
    .filter((item) => item.titulo.length > 0)
    .slice(0, 200);
}

r.get('/kanban', async (req, res) => {
  const email = resolverEmailUsuario(req);
  const pCol = await profileCol();
  const profile = (await pCol.findOne({ email })) || (await pCol.findOne({}));
  const goals = sanitizarKanbanGoals(profile?.kanban_goals) ?? [];
  res.json({ ok: true, kanban_goals: goals });
});

const salvarKanbanHandler = async (req: Request, res: any) => {
  const raw = Array.isArray(req.body) ? req.body : req.body?.kanban_goals ?? req.body?.goals;
  const goals = sanitizarKanbanGoals(raw);
  if (!goals) {
    res.status(400).json({ error: 'kanban_goals inválido' });
    return;
  }
  const email = resolverEmailUsuario(req);
  const pCol = await profileCol();
  const existing = (await pCol.findOne({ email })) || (await pCol.findOne({}));
  const filter = existing?._id ? { _id: existing._id } : { email };
  await pCol.updateOne(
    filter,
    {
      $set: { kanban_goals: goals, atualizadoEm: new Date() },
      $setOnInsert: { email, criadoEm: new Date() },
    },
    { upsert: true }
  );
  res.json({ ok: true, kanban_goals: goals });
};

r.put('/kanban', salvarKanbanHandler);
r.post('/kanban', salvarKanbanHandler);

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
  if (req.params.id.startsWith('google:')) {
    const eventId = typeof req.body?.googleEventId === 'string' ? req.body.googleEventId : req.params.id.slice(7);
    const calendarId = typeof req.body?.calendarId === 'string' ? req.body.calendarId : 'primary';
    const erro = validarCamposItem(req.body);
    if (erro || !req.body?.titulo || !req.body?.inicio) { res.status(400).json({ error: erro || 'dados inválidos' }); return; }
    await updateCalendarEvent(eventId, {
      titulo: String(req.body.titulo).trim(), descricao: String(req.body.descricao || ''),
      inicio: req.body.inicio, fim: req.body.fim, calendarId,
      colorId: getGoogleColorIdForPriority(req.body.corPrioridade),
    }, calendarId);
    res.json({ ok: true });
    return;
  }
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
  const colorId = getGoogleColorIdForPriority(merged.corPrioridade);
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
        colorId,
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
        colorId,
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
      colorId,
    });
    if (evId) {
      await c.updateOne({ _id }, { $set: { googleEventId: evId } });
      merged.googleEventId = evId;
    }
  }

  res.json(toApi(merged));
});

r.delete('/:id', async (req, res) => {
  if (req.params.id.startsWith('google:')) {
    const eventId = typeof req.query.eventId === 'string' ? req.query.eventId : req.params.id.slice(7);
    const calendarId = typeof req.query.calendarId === 'string' ? req.query.calendarId : 'primary';
    await deleteCalendarEvent(eventId, calendarId);
    res.status(204).end();
    return;
  }
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
