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

      db = d;
      return d;
    })().catch((e) => {
      connecting = null; // permite nova tentativa
      throw e;
    });
  }
  return connecting;
}
