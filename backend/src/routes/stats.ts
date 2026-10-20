import { Router } from 'express';
import { getDb } from '../lib/mongo';

const r = Router();

const todayKey = () => {
  // Fuso de Brasília (UTC-3): data local, não UTC
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d.toISOString().slice(0, 10);
};

const dateKey = (d: Date) => {
  const x = new Date(d);
  x.setHours(x.getHours() - 3);
  return x.toISOString().slice(0, 10);
};

const activityCol = async () => (await getDb()).collection<any>('activity');

/** GET /api/stats/heatmap?year=YYYY  (default: ano atual) */
r.get('/heatmap', async (req, res) => {
  const year = parseInt(String(req.query.year || ''), 10) || new Date().getFullYear();
  const inicio = `${year}-01-01`;
  const fim = `${year}-12-31`;

  const col = await activityCol();
  // Agrega a coleção `activity` do ano pedido; `_id` já é 'YYYY-MM-DD'
  const docs = await col
    .find({ _id: { $gte: inicio, $lte: fim } })
    .project({ _id: 1, concluidas: 1, minutosEstudo: 1 })
    .toArray();

  res.json(
    docs.map((d: any) => ({
      dia: d._id,
      concluidas: d.concluidas || 0,
      minutos: d.minutosEstudo || 0,
    }))
  );
});

/** GET /api/stats/summary -> { streakDias, minutosHoje, metaSemanal } */
r.get('/summary', async (_req, res) => {
  const col = await activityCol();
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  // Conta dias ativos consecutivos a partir da atividade mais recente.
  const diasAtivos = await col
    .find({
      $or: [{ concluidas: { $gt: 0 } }, { minutosEstudo: { $gt: 0 } }],
    })
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

  const docHoje = await col.findOne({ _id: hoje });

  res.json({
    streakDias,
    minutosHoje: docHoje?.minutosEstudo || 0,
    metaSemanal: 600,
  });
});

export default r;
