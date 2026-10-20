import { MongoClient, Db } from 'mongodb';

let db: Db | null = null;
let connecting: Promise<Db> | null = null;

/** Conexão preguiçosa e compartilhada com o MongoDB Atlas. */
export function getDb(): Promise<Db> {
  if (db) return Promise.resolve(db);
  if (!connecting) {
    connecting = (async () => {
      const uri = process.env.MONGODB_URI;
      if (!uri) throw new Error('MONGODB_URI não definida');
      const client = new MongoClient(uri);
      await client.connect();
      const d = client.db(process.env.MONGODB_DB || 'wall_dashboard');
      await d.collection('subscriptions').createIndex({ endpoint: 1 }, { unique: true });
      await d.collection('tasks').createIndex({ ordem: 1 });
      db = d;
      return d;
    })().catch((e) => {
      connecting = null; // permite nova tentativa
      throw e;
    });
  }
  return connecting;
}
