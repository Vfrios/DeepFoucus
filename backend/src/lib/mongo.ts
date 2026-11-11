import { MongoClient, Db } from 'mongodb';

let db: Db | null = null;
let connecting: Promise<Db> | null = null;

/**
 * Conexão preguiçosa e compartilhada com o MongoDB Atlas.
 *
 * Índices criados na primeira conexão:
 *  - subscriptions.endpoint (único)      → push
 *  - tasks.ordem                          → ordenação da lista legada
 *  - tasks.inicio                         → Página 1 (Hoje/Amanhã) e Página 2 (timeline)
 *  - tasks.tipo + tasks.inicio (composto) → filtros por tipo na agenda
 *  - notes.criadoEm                       → mural de notas (mais recentes primeiro)
 *  - shopping_list.comprado + criadoEm    → lista de compras
 *  - finance.data                         → filtro mensal e listagem de despesas
 *
 * A Promise é memoizada em `connecting`; se a conexão falhar, `connecting`
 * é resetado para `null` para permitir nova tentativa no próximo request.
 */
export function getDb(): Promise<Db> {
  if (db) return Promise.resolve(db);
  if (!connecting) {
    connecting = (async () => {
      const uri = process.env.MONGODB_URI;
      if (!uri) throw new Error('MONGODB_URI não definida');

      const client = new MongoClient(uri);
      await client.connect();

      const d = client.db(process.env.MONGODB_DB || 'wall_dashboard');

      // ---- FASE 1: índices ----
      // Push: uma subscription por endpoint
      await d.collection('subscriptions').createIndex({ endpoint: 1 }, { unique: true });

      // Tasks: ordenação da lista legada (drag-and-drop)
      await d.collection('tasks').createIndex({ ordem: 1 });

      // Tasks: consultas por data (Página 1 — Hoje/Amanhã; Página 2 — timeline)
      await d.collection('tasks').createIndex({ inicio: 1 });

      // Tasks: filtro composto por tipo dentro de um intervalo de datas (Página 3 — gráficos)
      await d.collection('tasks').createIndex({ tipo: 1, inicio: 1 });

      // Notas (Página 5 — mural): listagem por mais recentes
      await d.collection('notes').createIndex({ criadoEm: -1 });

      // Lista de compras: pendentes primeiro e itens mais novos antes
      await d.collection('shopping_list').createIndex({ comprado: 1, criadoEm: -1 });

      // Finanças: filtro por período e ordenação cronológica
      await d.collection('finance').createIndex({ data: -1 });

      // Saúde: dados e históricos isolados por usuário
      await d.collection('profile').createIndex({ email: 1 }, { unique: true, sparse: true });
      await d.collection('workouts').createIndex({ email: 1, diaSemana: 1 });
      await d.collection('workout_logs').createIndex({ email: 1, data: -1 });
      await d.collection('water_logs').createIndex({ email: 1, data: -1 });
      await d.collection('diets').createIndex({ email: 1, geradoEm: -1 });

      db = d;
      return d;
    })().catch((e) => {
      connecting = null; // permite nova tentativa
      throw e;
    });
  }
  return connecting;
}
