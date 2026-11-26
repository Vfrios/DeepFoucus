import { MongoClient, Db } from 'mongodb';
import { DEFAULT_CATEGORIES, normalizeCategoryName } from './financeCategories';

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
 *  - shopping.status + criadoEm           → dispensa e carrinho
 *  - recipes.criadoEm                     → receitas geradas
 *  - finance.data                         → filtro mensal e listagem de despesas
 *  - categories.nomeNormalizado           → nome único e lookup de categorias
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

      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 15000 });
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

      // ERP doméstico: itens por estado e receitas mais recentes primeiro
      await d.collection('shopping').createIndex({ status: 1, criadoEm: -1 });
      await d.collection('recipes').createIndex({ criadoEm: -1 });
      await d.collection('device_pairings').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

      // Finanças: filtro por período e ordenação cronológica
      await d.collection('finance').createIndex({ data: -1 });

      // Migração das categorias para lookup normalizado e idempotente.
      const categories = d.collection('categories');
      const legacyCategories = await categories.find({ nomeNormalizado: { $exists: false } }).toArray();
      for (const category of legacyCategories) {
        if (typeof category.nome !== 'string') continue;
        await categories.updateOne(
          { _id: category._id, nomeNormalizado: { $exists: false } },
          { $set: { nomeNormalizado: normalizeCategoryName(category.nome) } }
        );
      }
      await categories.createIndex(
        { nomeNormalizado: 1 },
        { unique: true, partialFilterExpression: { nomeNormalizado: { $type: 'string' } } }
      );
      const now = new Date();
      for (const category of DEFAULT_CATEGORIES) {
        const nomeNormalizado = normalizeCategoryName(category.nome);
        await categories.updateOne(
          { nomeNormalizado },
          {
            $setOnInsert: {
              ...category,
              nomeNormalizado,
              criadoPor: 'user',
              criadoEm: now,
              atualizadoEm: now,
            },
          },
          { upsert: true }
        );
      }

      // Saúde: dados e históricos isolados por usuário
      await d.collection('profile').createIndex({ email: 1 }, { unique: true, sparse: true });
      await d.collection('workouts').createIndex({ email: 1, diaSemana: 1 });
      await d.collection('workout_logs').createIndex({ email: 1, data: -1 });
      await d.collection('workout_logs').createIndex({ email: 1, exercicio: 1, data: -1 });
      await d.collection('workout_sessions').createIndex({ email: 1, sessionKey: 1 }, { unique: true });
      await d.collection('workout_sessions').createIndex({ email: 1, status: 1, scheduledFor: -1 });
      await d.collection('water_logs').createIndex({ email: 1, data: -1 });
      await d.collection('weight_logs').createIndex({ email: 1, data: -1 });
      await d.collection('diets').createIndex({ email: 1, geradoEm: -1 });
      await d.collection('daily_plans').createIndex({ email: 1, data: 1 }, { unique: true });

      // Canvas LMS (PUC)
      await d.collection('canvas_courses').createIndex({ canvas_id: 1 }, { unique: true });
      await d.collection('canvas_assignments').createIndex({ course_id: 1, canvas_id: 1 }, { unique: true });
      await d.collection('canvas_assignments').createIndex({ due_at: 1 });
      await d.collection('canvas_assignments').createIndex({ course_id: 1, project_id: 1 });
      await d.collection('canvas_announcements').createIndex({ course_id: 1, canvas_id: 1 }, { unique: true });
      await d.collection('canvas_announcements').createIndex({ posted_at: -1 });
      await d.collection('canvas_pages').createIndex({ course_id: 1, slug: 1 }, { unique: true });
      await d.collection('canvas_files').createIndex({ course_id: 1, canvas_id: 1 }, { unique: true });
      await d.collection('canvas_modules').createIndex({ course_id: 1, canvas_id: 1 }, { unique: true });
      await d.collection('canvas_sync_log').createIndex({ started_at: -1 });

      // Assistente de Trabalhos PUC
      await d.collection('puc_projects').createIndex({ course_id: 1, project_id: 1 }, { unique: true });
      await d.collection('puc_deliverables').createIndex({ course_id: 1, assignment_id: 1 }, { unique: true });
      await d.collection('puc_deliverables').createIndex({ status: 1, updated_at: -1 });
      await d.collection('puc_course_lessons').createIndex({ course_id: 1 }, { unique: true });

      // Agente de Automação PUC (jobs assíncronos + decisões)
      await d.collection('puc_jobs').createIndex({ job_id: 1 }, { unique: true });
      await d.collection('puc_jobs').createIndex({ status: 1, priority_due_at: 1, created_at: 1 });
      await d.collection('puc_jobs').createIndex({ course_id: 1, assignment_id: 1, status: 1 });
      await d.collection('puc_agent_records').createIndex({ course_id: 1, assignment_id: 1 }, { unique: true });
      await d.collection('puc_agent_records').createIndex({ status: 1, updated_at: -1 });

      // Briefing da manhã (cache diário + histórico para anti-repetição)
      await d.collection('briefings').createIndex({ dateKey: 1 }, { unique: true });

      db = d;
      return d;
    })().catch((e) => {
      connecting = null; // permite nova tentativa
      throw e;
    });
  }
  return connecting;
}
