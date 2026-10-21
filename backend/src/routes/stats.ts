import { Router } from 'express';
import { getDb } from '../lib/mongo';
import { gerarInsightIA, EstatisticasInsight } from '../lib/ai';

const r = Router();

const activityCol = async () => (await getDb()).collection<any>('activity');
const tasksCol = async () => (await getDb()).collection<any>('tasks');

/** GET /api/stats/heatmap?year=YYYY — inalterado em relação ao original. */
r.get('/heatmap', async (req, res) => {
  const year = parseInt(String(req.query.year || ''), 10) || new Date().getFullYear();
  const inicio = `${year}-01-01`;
  const fim = `${year}-12-31`;

  const col = await activityCol();
  const docs = await col
    .find({ _id: { $gte: inicio, $lte: fim } })
    .project({ _id: 1, concluidas: 1 })
    .toArray();

  res.json(
    docs.map((d: any) => ({
      dia: d._id,
      concluidas: d.concluidas || 0,
    }))
  );
});

/** GET /api/stats/summary — inalterado em relação ao original. */
r.get('/summary', async (_req, res) => {
  const col = await activityCol();
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  const diasAtivos = await col
    .find({ concluidas: { $gt: 0 } })
    .project({ _id: 1 })
    .sort({ _id: -1 })
    .toArray();
  const conjuntoDias = new Set<string>(diasAtivos.map((d) => String(d._id)));
  const ultimaAtividade = diasAtivos[0]?._id;

  let streakDias = 0;
  const dataOntem = new Date(`${hoje}T00:00:00.000Z`);
  dataOntem.setUTCDate(dataOntem.getUTCDate() - 1);
  const ontem = dataOntem.toISOString().slice(0, 10);

  if (ultimaAtividade === hoje || ultimaAtividade === ontem) {
    const cursor = new Date(`${ultimaAtividade}T00:00:00.000Z`);
    while (conjuntoDias.has(cursor.toISOString().slice(0, 10))) {
      streakDias++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  res.json({ streakDias });
});

// ---------- FASE 4: breakdown por tipo ----------

type Tipo = 'tarefa' | 'evento' | 'estudo';
interface BreakdownItem {
  contagem: number;
}

/**
 * GET /api/stats/breakdown?days=7
 * Retorna a contagem de itens concluídos por tipo no intervalo.
 */
r.get('/breakdown', async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1), 90);
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  const fromISO = from.toISOString();

  const col = await tasksCol();
  // Consideramos itens com `inicio` no intervalo OU sem data (para contagem global)
  const docs = await col
    .find({
      feito: true,
      $or: [{ inicio: { $gte: fromISO } }, { inicio: null }],
    })
    .project({ tipo: 1 })
    .toArray();

  const acc: Record<Tipo, BreakdownItem> = {
    tarefa: { contagem: 0 },
    evento: { contagem: 0 },
    estudo: { contagem: 0 },
  };

  for (const d of docs) {
    const tipo: Tipo =
      d.tipo === 'evento' || d.tipo === 'estudo' ? d.tipo : 'tarefa';
    acc[tipo].contagem += 1;
  }

  res.json({ days, ...acc });
});

// ---------- FASE 4: insights (gráficos + texto IA) ----------

interface InsightsPayload {
  streakDias: number;
  tarefasPendentes: number;
  tarefasConcluidas: number;
  dias: Array<{ dia: string; concluidas: number }>;
  breakdown: Record<Tipo, BreakdownItem>;
  insight: string | null;
  insightErro?: string;
}

// Cache simples: chave = hash dos dados agregados; TTL 60s
const cacheInsight = new Map<string, { at: number; payload: InsightsPayload }>();
const TTL_MS = 60_000;

r.get('/insights', async (_req, res) => {
  try {
    const col = await activityCol();
    const tasks = await tasksCol();
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const anoAtual = new Date().getFullYear();

    // --- dias do ano (heatmap) ---
    const inicioAno = `${anoAtual}-01-01`;
    const fimAno = `${anoAtual}-12-31`;
    const diasDocs = await col
      .find({ _id: { $gte: inicioAno, $lte: fimAno } })
      .project({ _id: 1, concluidas: 1 })
      .toArray();
    const dias = diasDocs.map((d: any) => ({
      dia: String(d._id),
      concluidas: d.concluidas || 0,
    }));

    // --- streak baseado somente em tarefas concluídas ---
    const diasAtivos = await col
      .find({ concluidas: { $gt: 0 } })
      .project({ _id: 1 })
      .sort({ _id: -1 })
      .toArray();
    const conjuntoDias = new Set<string>(diasAtivos.map((d) => String(d._id)));
    const ultimaAtividade = diasAtivos[0]?._id;
    let streakDias = 0;
    const dataOntem = new Date(`${hoje}T00:00:00.000Z`);
    dataOntem.setUTCDate(dataOntem.getUTCDate() - 1);
    const ontem = dataOntem.toISOString().slice(0, 10);
    if (ultimaAtividade === hoje || ultimaAtividade === ontem) {
      const cursor = new Date(`${ultimaAtividade}T00:00:00.000Z`);
      while (conjuntoDias.has(cursor.toISOString().slice(0, 10))) {
        streakDias++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
    }
    // --- breakdown por tipo (7 dias) ---
    const from = new Date();
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    const fromISO = from.toISOString();
    const tasksDocs = await tasks
      .find({ feito: true, $or: [{ inicio: { $gte: fromISO } }, { inicio: null }] })
      .project({ tipo: 1 })
      .toArray();
    const taskCounts = await tasks
      .aggregate<{ _id: 'pendentes' | 'concluidas'; total: number }>([
        {
          $group: {
            _id: {
              $cond: [{ $eq: ['$feito', true] }, 'concluidas', 'pendentes'],
            },
            total: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const tarefasPendentes = taskCounts.find((item) => item._id === 'pendentes')?.total ?? 0;
    const tarefasConcluidas = taskCounts.find((item) => item._id === 'concluidas')?.total ?? 0;
    const breakdown: Record<Tipo, BreakdownItem> = {
      tarefa: { contagem: 0 },
      evento: { contagem: 0 },
      estudo: { contagem: 0 },
    };
    for (const d of tasksDocs) {
      const tipo: Tipo =
        d.tipo === 'evento' || d.tipo === 'estudo' ? d.tipo : 'tarefa';
      breakdown[tipo].contagem += 1;
    }

    // --- chave de cache ---
    const cacheKey = JSON.stringify({
      s: streakDias,
      tp: tarefasPendentes,
      tc: tarefasConcluidas,
      d: dias.slice(-14), // últimos 14 dias bastam para detectar mudança
      b: breakdown,
    });
    const hit = cacheInsight.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      res.json(hit.payload);
      return;
    }

    // --- texto da IA ---
    const statsParaIA: EstatisticasInsight = {
      streakDias,
      tarefasPendentes,
      tarefasConcluidas,
      dias,
      porTipo: {
        tarefa: breakdown.tarefa.contagem,
        evento: breakdown.evento.contagem,
        estudo: breakdown.estudo.contagem,
      },
    };

    let insight: string | null = null;
    let insightErro: string | undefined;
    try {
      insight = await gerarInsightIA(statsParaIA);
    } catch (e: any) {
      insightErro = e?.message || 'IA indisponível';
    }

    const payload: InsightsPayload = {
      streakDias,
      tarefasPendentes,
      tarefasConcluidas,
      dias,
      breakdown,
      insight,
      ...(insightErro ? { insightErro } : {}),
    };

    cacheInsight.set(cacheKey, { at: Date.now(), payload });
    if (cacheInsight.size > 30) {
      // limpeza simples: remove a chave mais antiga
      const first = cacheInsight.keys().next().value as string | undefined;
      if (first) cacheInsight.delete(first);
    }

    res.json(payload);
  } catch (e: any) {
    console.error('[stats/insights] erro:', e?.message || e);
    res.status(500).json({ error: 'stats_error', detalhe: e?.message || 'erro' });
  }
});

export default r;
