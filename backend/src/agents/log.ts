import { getDb } from '../lib/mongo';

export async function agentLog(entry: Record<string, unknown>): Promise<void> {
  console.log('[agent]', JSON.stringify(entry));
  try {
    await (await getDb()).collection('agent_logs').insertOne({ ...entry, createdAt: new Date() });
  } catch (error) {
    // Logging must never recursively call itself when MongoDB is unavailable.
    console.error('[agent] agent_logs indisponível', error instanceof Error ? error.message : String(error));
  }
}
